import fs from "node:fs/promises";
import path from "node:path";
import type {
  ForeachStage,
  LoopStage,
  StandardStage,
  WorkflowCommand,
  WorkflowDef,
  WorkflowStage,
  WorkflowStep,
  RuntimeFallbackCandidate,
} from "../schema.js";
import {
  appendEvent,
  checkpointsDir,
  initFlowState,
  loadFlowState,
  promptsDir,
  logsDir,
  saveFlowState,
  workflowHash,
  UnitState,
  type FlowState,
} from "./state.js";
import { expandForeachItems, resolveItemTemplates } from "./foreach.js";
import { resolveWithin } from "./safe-paths.js";
import { evaluateStopCondition } from "./stop-condition.js";
import { renderUnitPrompt } from "./prompt.js";
import { runValidators } from "./validators.js";
import { getWorkerRuntime } from "./runtimes/registry.js";
import { acquireFlowLock, releaseFlowLock } from "./lock.js";
import type { StageRunResult, WorkerRuntime } from "./runtimes/base.js";

export type RunFlowOptions = {
  workflow: WorkflowDef;
  workspaceDir: string;
  runtime: WorkerRuntime;
  /** Re-initialize state when the workflow definition changed. */
  reset?: boolean;
  /** Backoff between rate-limited retries (tests use 0). */
  backoffMs?: number;
  /** Label recorded in the workspace lock (cli/dashboard/supervisor). */
  lockHolder?: string;
};

const MAX_BACKOFFS = 5;
// Skill documents are prompt context, not an unbounded workspace dump. These
// caps keep a broad glob such as fulltext/*.md from silently exhausting a
// provider context window. Workers can still use the declared file paths via
// a CLI harness when their runtime supports it.
const MAX_SKILL_DOCUMENTS = 24;
const MAX_SKILL_CHARS = 180_000;
const PAUSE_OUTCOMES = new Set([
  "quota_exhausted",
  "permission_blocked",
  "tool_missing",
  "model_unavailable",
  "budget_exceeded",
]);

export type WorkUnitSpec = {
  key: string;
  title?: string;
  owner: string;
  inputs: string[];
  optional_inputs: string[];
  outputs: string[];
  tools: string[];
  allowed_tools: string[];
  instructions: string[];
  skills: string[];
  validators: string[];
  validator_commands: WorkflowCommand[];
  requires_human_approval?: boolean;
  retry?: { max_attempts: number };
  runtime?: string;
  model?: string;
  model_tier?: string;
  command?: { cmd: string; args: string[] };
  enabled: boolean;
  skippable: boolean;
  disabled_reason?: string;
  stageId: string;
  stepId?: string;
  itemId?: string;
};

type ExecutableStage = StandardStage | ForeachStage;
type StageOutcome = "succeeded" | "failed" | "paused" | "awaiting_review";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function concreteOutputs(outputs: string[]): string[] {
  return outputs.filter((o) => !o.includes("*") && !o.includes("{{"));
}

function artifactPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\{\{[^}]+\}\}/g, "*")
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

async function listWorkspaceFiles(root: string, relative = ""): Promise<string[]> {
  const absolute = relative ? resolveWithin(root, relative) : root;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    // Do not inject engine logs/prompts or traverse symlinks. Skill globs are
    // deliberately limited to ordinary workspace artifacts.
    if (entry.name === ".malaclaw" || entry.isSymbolicLink()) continue;
    const rel = relative ? path.posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await listWorkspaceFiles(root, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

/** Resolve static paths, foreach templates, and workspace-local `*` skill
 * globs into bounded prompt documents. Globs are expanded deterministically
 * in lexical order so a rerun receives the same evidence context. */
async function loadSkillDocuments(
  workspaceDir: string,
  skillPaths: string[],
): Promise<Array<{ path: string; content: string }>> {
  const allFiles = skillPaths.some((skillPath) => skillPath.includes("*"))
    ? await listWorkspaceFiles(workspaceDir)
    : [];
  const resolved = new Set<string>();
  for (const skillPath of skillPaths) {
    if (skillPath.includes("*")) {
      const regex = artifactPatternToRegex(skillPath);
      for (const file of allFiles) if (regex.test(file)) resolved.add(file);
    } else {
      resolved.add(skillPath);
    }
  }

  const docs: Array<{ path: string; content: string }> = [];
  let remaining = MAX_SKILL_CHARS;
  for (const skillPath of [...resolved].sort()) {
    if (docs.length >= MAX_SKILL_DOCUMENTS || remaining <= 0) break;
    try {
      const content = await fs.readFile(resolveWithin(workspaceDir, skillPath), "utf-8");
      const clipped = content.slice(0, remaining);
      docs.push({
        path: skillPath,
        content: clipped.length < content.length
          ? `${clipped}\n\n[Longer skill document truncated by MalaClaw prompt-context limit.]`
          : clipped,
      });
      remaining -= clipped.length;
    } catch {
      // Preserve the prior fail-visible behavior for declared but missing
      // static skill documents. A glob that matches nothing is not an error.
      if (!skillPath.includes("*")) docs.push({ path: skillPath, content: "(skill document missing from workspace)" });
    }
  }
  if (resolved.size > docs.length && docs.length >= MAX_SKILL_DOCUMENTS) {
    docs.push({ path: "[skill-context-limit]", content: `Only the first ${MAX_SKILL_DOCUMENTS} skill documents were injected.` });
  }
  return docs;
}

function resolveRuntimeId(spec: WorkUnitSpec, workflow: WorkflowDef, fallback: string): string {
  if (spec.runtime) return spec.runtime;
  if (spec.model_tier && workflow.model_tiers?.[spec.model_tier]) {
    return workflow.model_tiers[spec.model_tier].runtime;
  }
  return workflow.runtime_policy?.primary ?? fallback;
}

function resolveModel(spec: WorkUnitSpec, workflow: WorkflowDef): string | undefined {
  if (spec.model) return spec.model;
  if (spec.model_tier) return workflow.model_tiers?.[spec.model_tier]?.model;
  return undefined;
}

function normalizeFallback(candidate: RuntimeFallbackCandidate): { runtime: string; model?: string } {
  return typeof candidate === "string" ? { runtime: candidate } : candidate;
}

/** When a unit produces the artifact a later foreach stage fans out over,
 *  the worker must be told the required JSON shape — discovered the hard way
 *  in the first novel flagship run, where a rich outline.json lacked the
 *  "chapters" id array and the fan-out had nothing to expand. */
function foreachContractNotes(workflow: WorkflowDef, spec: WorkUnitSpec): string[] {
  const notes: string[] = [];
  const visit = (stage: WorkflowStage): void => {
    if ("stages" in stage) {
      for (const child of stage.stages) visit(child);
      return;
    }
    if (!("steps" in stage)) return;
    const dot = stage.foreach.indexOf(".");
    const base = dot === -1 ? stage.foreach : stage.foreach.slice(0, dot);
    const key = dot === -1 ? "items" : stage.foreach.slice(dot + 1);
    const artifact = `${base}.json`;
    if (spec.outputs.includes(artifact)) {
      notes.push(
        `${artifact} MUST be JSON with a top-level "${key}" array of objects, ` +
        `each carrying a unique string "id" (start with a letter/digit; then letters, digits, ".", "_", "-"; ` +
        `e.g. "chapter-001"). Stage "${stage.id}" creates one work item per id — without them it cannot run. ` +
        `Additional fields per object are welcome.`,
      );
    }
  };
  for (const stage of workflow.stages) visit(stage);
  return notes;
}

/** Capability requirements a unit's declaration implies. */
function unitCapabilityFindings(
  spec: WorkUnitSpec,
  workflow: WorkflowDef,
  fallbackRuntimeId: string,
): string[] {
  const runtimeId = resolveRuntimeId(spec, workflow, fallbackRuntimeId);
  let capabilities;
  try {
    capabilities = getWorkerRuntime(runtimeId).capabilities;
  } catch {
    return [`${spec.key}: unknown runtime "${runtimeId}"`];
  }
  const findings: string[] = [];
  const nonGlob = spec.outputs.filter((o) => !o.includes("*"));
  const needsMultiFile = nonGlob.length > 1 || spec.outputs.some((o) => o.includes("*"));
  if (needsMultiFile && !capabilities.multi_file_edit) {
    findings.push(
      `${spec.key}: declares ${spec.outputs.length} outputs but runtime "${runtimeId}" is single-output — use claude-code, codex, or script`,
    );
  }
  if (spec.allowed_tools.length > 0 && !capabilities.cli_harness_tools) {
    findings.push(
      `${spec.key}: allowed_tools requires a CLI harness runtime (claude-code, codex); "${runtimeId}" has no harness tools`,
    );
  }
  if (spec.command && !capabilities.declared_command_tool) {
    findings.push(
      `${spec.key}: declares command but runtime "${runtimeId}" cannot run declared commands`,
    );
  }
  return findings;
}

/** Pre-execution check: every unit's declared needs vs its resolved runtime's
 *  capabilities. Returns human-readable mismatches; empty means safe to run. */
export function findCapabilityMismatches(workflow: WorkflowDef, fallbackRuntimeId: string): string[] {
  const findings: string[] = [];
  const visit = (stage: WorkflowStage): void => {
    if (!stage.enabled) return;
    if ("stages" in stage) {
      for (const child of stage.stages) visit(child);
      return;
    }
    if ("steps" in stage) {
      for (const step of stage.steps) {
        if (!step.enabled) continue;
        findings.push(...unitCapabilityFindings(stepToSpec(stage, step, "item"), workflow, fallbackRuntimeId));
      }
      return;
    }
    findings.push(...unitCapabilityFindings(stageToSpec(stage), workflow, fallbackRuntimeId));
  };
  for (const stage of workflow.stages) visit(stage);
  return findings;
}

/** True when any unit of this stage resolves to a model tier marked
 *  requires_budget_approval — the stage must be pre-approved before spend. */
function needsBudgetApproval(stage: WorkflowStage, workflow: WorkflowDef): boolean {
  if (!stage.enabled) return false;
  const tiers = workflow.model_tiers ?? {};
  const gated = (tierId?: string) => tierId !== undefined && tiers[tierId]?.requires_budget_approval === true;
  if ("stages" in stage) return stage.stages.some((child) => needsBudgetApproval(child, workflow));
  if ("steps" in stage) return stage.steps.some((step) => gated(step.model_tier));
  return gated(stage.model_tier);
}

function queueBudgetApproval(state: FlowState, stageId: string): void {
  if (state.pendingApprovals.some((a) => a.stageId === stageId && a.id.startsWith("approve-budget-"))) {
    return;
  }
  state.units[stageId].budgetApproved = false;
  state.pendingApprovals.push({
    id: `approve-budget-${stageId}-${String(state.pendingApprovals.length + 1).padStart(3, "0")}`,
    kind: "budget",
    stageId,
    artifacts: [],
  });
}

async function checkpointOutputs(workspaceDir: string, unitKey: string, outputs: string[]): Promise<void> {
  const existing: string[] = [];
  for (const output of concreteOutputs(outputs)) {
    try {
      // resolveWithin guards against traversal (schema forbids it; item ids
      // are validated at expansion — this is defense in depth).
      await fs.access(resolveWithin(workspaceDir, output));
      existing.push(output);
    } catch {
      // nothing to checkpoint (or unsafe path — never copied)
    }
  }
  if (existing.length === 0) return;
  const dir = path.join(
    checkpointsDir(workspaceDir),
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${unitKey}`,
  );
  for (const output of existing) {
    const dest = resolveWithin(dir, output);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(resolveWithin(workspaceDir, output), dest);
  }
}

async function writeBlocker(
  workspaceDir: string, unitKey: string, result: StageRunResult,
): Promise<void> {
  const reportPath = resolveWithin(path.join(workspaceDir, "reports"), `${unitKey}-blocker.md`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    `# Blocker: ${unitKey}\n\nOutcome: ${result.outcome}\n\n${result.message ?? ""}\n`,
    "utf-8",
  );
}

async function appendValidationReport(
  workspaceDir: string, unitKey: string, findings: string[], pass: boolean,
): Promise<void> {
  const reportPath = path.join(workspaceDir, "reports", "validation.md");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const body =
    `\n## ${new Date().toISOString()} — ${unitKey}: ${pass ? "PASS" : "FAIL"}\n` +
    (findings.length > 0 ? findings.map((f) => `- ${f}`).join("\n") + "\n" : "");
  await fs.appendFile(reportPath, body, "utf-8");
}

function unitTimeoutMs(workflow: WorkflowDef): number {
  const minutes = workflow.run_limits?.max_unit_minutes;
  return minutes !== undefined ? Math.round(minutes * 60_000) : 600_000;
}

function usageTokens(usage?: StageRunResult["usage"]): number {
  if (!usage) return 0;
  return usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

/** Attempt-level telemetry: EVERY attempt's tokens and active time are
 *  recorded in state (failed and retried attempts included), so run limits
 *  never undercount consumption. */
async function recordAttemptTelemetry(
  workspaceDir: string,
  state: FlowState,
  unitKey: string,
  result: StageRunResult,
  startedAtMs: number,
  runtime: string,
  model?: string,
): Promise<void> {
  state.telemetry.recordedTokens += usageTokens(result.usage);
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  state.telemetry.activeMs += elapsedMs;
  await appendEvent(workspaceDir, {
    type: "unit_attempt_finished",
    key: unitKey,
    outcome: result.outcome,
    runtime,
    model,
    elapsedMs,
    usage: result.usage,
  });
}

export type RunLimitCheck = { exceeded: boolean; reason?: string };

/** Checked BETWEEN units: recorded tokens and active worker time vs the
 *  workflow run_limits. Can overshoot by one in-flight unit — the per-unit
 *  timeout bounds that overshoot; this is a guardrail, not a hard meter. */
export function checkRunLimits(workflow: WorkflowDef, state: FlowState): RunLimitCheck {
  const limits = workflow.run_limits;
  if (!limits) return { exceeded: false };
  if (limits.max_recorded_tokens !== undefined && state.telemetry.recordedTokens >= limits.max_recorded_tokens) {
    return {
      exceeded: true,
      reason: `recorded tokens ${state.telemetry.recordedTokens.toLocaleString("en-US")} reached max_recorded_tokens ${limits.max_recorded_tokens.toLocaleString("en-US")}`,
    };
  }
  if (limits.max_active_run_minutes !== undefined && state.telemetry.activeMs >= limits.max_active_run_minutes * 60_000) {
    return {
      exceeded: true,
      reason: `active worker time ${(state.telemetry.activeMs / 60_000).toFixed(1)} min reached max_active_run_minutes ${limits.max_active_run_minutes}`,
    };
  }
  return { exceeded: false };
}

async function pauseForRunLimit(
  workspaceDir: string,
  state: FlowState,
  reason: string,
): Promise<void> {
  const reportPath = path.join(workspaceDir, "reports", "run-limits-blocker.md");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    "# Run limit reached\n\n" +
    `${reason}\n\n` +
    "The flow paused BEFORE starting the next unit. State, artifacts, and\n" +
    "pending work are preserved. To continue: raise the limit in the\n" +
    "workflow's run_limits (or remove it) and re-run — completed units are\n" +
    "not repeated. Recorded totals: " +
    `${state.telemetry.recordedTokens.toLocaleString("en-US")} tokens, ` +
    `${(state.telemetry.activeMs / 60_000).toFixed(1)} active minutes.\n`,
    "utf-8",
  );
  await appendEvent(workspaceDir, {
    type: "run_limit_reached",
    reason,
    recordedTokens: state.telemetry.recordedTokens,
    activeMs: state.telemetry.activeMs,
  });
}

/** Run one unit to a terminal outcome: succeeded, failed, or paused. */
async function runUnit(
  spec: WorkUnitSpec,
  opts: RunFlowOptions,
  state: FlowState,
  initialFeedback?: string[],
): Promise<"succeeded" | "failed" | "paused"> {
  const { workspaceDir, workflow, runtime } = opts;
  const unitKey = spec.key;
  state.units[unitKey] ??= { status: "pending", attempts: 0, rounds: 0, approvalGranted: false, budgetApproved: false };
  const unit = state.units[unitKey];
  const maxAttempts = spec.retry?.max_attempts ?? 2;
  const requestedRuntimeId = resolveRuntimeId(spec, workflow, runtime.id);
  const unitRuntime = requestedRuntimeId === runtime.id ? runtime : getWorkerRuntime(requestedRuntimeId);
  const requestedModel = resolveModel(spec, workflow);
  unit.requestedRuntime = requestedRuntimeId;
  unit.actualRuntime = unitRuntime.id;
  unit.requestedModel = requestedModel;
  unit.actualModel = requestedModel;

  // Run-limit guardrail, checked before EVERY unit (standard, foreach item,
  // loop child): pause with preserved state instead of starting new spend.
  const limitCheck = checkRunLimits(workflow, state);
  if (limitCheck.exceeded) {
    unit.status = "pending";
    await pauseForRunLimit(workspaceDir, state, limitCheck.reason ?? "run limit reached");
    return "paused";
  }

  await checkpointOutputs(workspaceDir, unitKey, spec.outputs);

  let retryFeedback: string[] | undefined = initialFeedback;
  let backoffs = 0;

  while (unit.attempts < maxAttempts) {
    unit.attempts += 1;
    unit.status = "running";
    await appendEvent(workspaceDir, {
      type: "unit_started", key: unitKey, attempt: unit.attempts,
      requestedRuntime: requestedRuntimeId, actualRuntime: unitRuntime.id,
    });

    const skillDocs = await loadSkillDocuments(workspaceDir, spec.skills);
    // Owner persona: roles/<owner>.md is the workspace-level convention for
    // giving each owner distinct instructions (LongWrite compiles its agent
    // templates into these). Absent file = owner stays a plain label.
    let roleDoc: string | undefined;
    try {
      roleDoc = await fs.readFile(
        resolveWithin(path.join(workspaceDir, "roles"), `${spec.owner}.md`),
        "utf-8",
      );
    } catch {
      roleDoc = undefined;
    }
    const prompt = renderUnitPrompt({
      stage: spec, unitKey, retryFeedback, skillDocs, roleDoc,
      contractNotes: foreachContractNotes(workflow, spec),
    });
    await fs.mkdir(promptsDir(workspaceDir), { recursive: true });
    // Revision rounds reset the attempt counter, so tag the round to keep
    // round 2 from overwriting round 1's prompt and log.
    const fileTag = unit.rounds > 0
      ? `${unitKey}-round${unit.rounds + 1}-attempt${unit.attempts}`
      : `${unitKey}-attempt${unit.attempts}`;
    const promptPath = resolveWithin(promptsDir(workspaceDir), `${fileTag}.md`);
    const logPath = resolveWithin(logsDir(workspaceDir), `${fileTag}.log`);
    await fs.writeFile(promptPath, prompt, "utf-8");

    let attemptStartedAt = Date.now();
    let result = await unitRuntime.runStage({
      owner: spec.owner, instructions: prompt,
      workspaceDir, unitKey,
      outputs: spec.outputs, timeoutMs: unitTimeoutMs(workflow),
      command: spec.command,
      allowedTools: spec.allowed_tools.length > 0 ? spec.allowed_tools : undefined,
      model: requestedModel, promptPath, logPath,
    });
    await recordAttemptTelemetry(workspaceDir, state, unitKey, result, attemptStartedAt, unitRuntime.id, requestedModel);

    // Rate limits back off and re-run without consuming an attempt.
    while (result.outcome === "rate_limited") {
      unit.lastOutcome = result.outcome;
      if (workflow.runtime_policy?.on_rate_limit === "fail" || backoffs >= MAX_BACKOFFS) {
        unit.status = "failed";
        unit.lastError = "rate limited too many times";
        await appendEvent(workspaceDir, { type: "unit_failed", key: unitKey, outcome: result.outcome });
        return "failed";
      }
      backoffs += 1;
      await appendEvent(workspaceDir, { type: "unit_backoff", key: unitKey, backoffs });
      await sleep(opts.backoffMs ?? 1000);
      attemptStartedAt = Date.now();
      result = await unitRuntime.runStage({
        workspaceDir, unitKey, owner: spec.owner, instructions: prompt,
        outputs: spec.outputs, timeoutMs: unitTimeoutMs(workflow),
        command: spec.command,
      allowedTools: spec.allowed_tools.length > 0 ? spec.allowed_tools : undefined,
        model: requestedModel, promptPath, logPath,
      });
      await recordAttemptTelemetry(workspaceDir, state, unitKey, result, attemptStartedAt, unitRuntime.id, requestedModel);
    }

    unit.lastOutcome = result.outcome;

    // Explicit quota fallback: only when the policy declares try_fallback
    // AND a fallback runtime is listed AND it is capability-compatible with
    // this unit. Never silent — recorded in state and events. Anything else
    // pauses exactly as before.
    if (result.outcome === "quota_exhausted" && workflow.runtime_policy?.on_quota_exhausted === "try_fallback") {
      let fallback: { runtime: string; model?: string } | undefined;
      let fallbackRuntime: WorkerRuntime | undefined;
      for (const rawCandidate of workflow.runtime_policy.fallback ?? []) {
        const candidate = normalizeFallback(rawCandidate);
        if (candidate.runtime === unitRuntime.id) continue;
        if (unitCapabilityFindings({ ...spec, runtime: candidate.runtime }, workflow, candidate.runtime).length > 0) continue;
        const candidateRuntime = getWorkerRuntime(candidate.runtime);
        if (!(await candidateRuntime.checkAvailable()).available) continue;
        fallback = candidate;
        fallbackRuntime = candidateRuntime;
        break;
      }
      if (fallback && fallbackRuntime) {
        // A fallback provider must not inherit the primary provider's model
        // id. Bare cross-runtime fallbacks use their runtime default; same-
        // runtime fallbacks keep the selected model unless overridden.
        const fallbackModel = fallback.model ?? (fallback.runtime === unitRuntime.id ? requestedModel : undefined);
        await appendEvent(workspaceDir, {
          type: "runtime_fallback", key: unitKey,
          from: unitRuntime.id, to: fallback.runtime, fromModel: requestedModel,
          toModel: fallbackModel, reason: "quota_exhausted",
        });
        unit.actualRuntime = fallback.runtime;
        unit.actualModel = fallbackModel;
        const fallbackStartedAt = Date.now();
        result = await fallbackRuntime.runStage({
          owner: spec.owner, instructions: prompt,
          workspaceDir, unitKey,
          outputs: spec.outputs, timeoutMs: unitTimeoutMs(workflow),
          command: spec.command,
          allowedTools: spec.allowed_tools.length > 0 ? spec.allowed_tools : undefined,
          model: fallbackModel, promptPath, logPath,
        });
        await recordAttemptTelemetry(workspaceDir, state, unitKey, result, fallbackStartedAt, fallback.runtime, fallbackModel);
        unit.lastOutcome = result.outcome;
      }
    }

    if (PAUSE_OUTCOMES.has(result.outcome)) {
      unit.status = "pending"; // re-runnable once the blocker clears
      unit.attempts -= 1; // the blocked attempt does not count
      if (result.retryAfterMs !== undefined) {
        unit.retryAt = new Date(Date.now() + result.retryAfterMs).toISOString();
      } else {
        delete unit.retryAt;
      }
      await writeBlocker(workspaceDir, unitKey, result);
      await appendEvent(workspaceDir, { type: "flow_paused_blocker", key: unitKey, outcome: result.outcome });
      return "paused";
    }

    if (result.outcome === "success") {
      delete unit.retryAt;
      const report = await runValidators(spec.validators, spec.outputs, workspaceDir, spec.validator_commands);
      await appendValidationReport(workspaceDir, unitKey, report.findings, report.pass);
      if (report.pass) {
        unit.status = "succeeded";
        await appendEvent(workspaceDir, { type: "unit_succeeded", key: unitKey, usage: result.usage });
        return "succeeded";
      }
      retryFeedback = report.findings;
      unit.lastError = report.findings.join("; ");
      await appendEvent(workspaceDir, {
        type: "unit_validation_failed", key: unitKey, findings: report.findings, usage: result.usage,
      });
      continue;
    }

    // worker_error / timeout / validation_failed from the runtime itself
    unit.lastError = result.message ?? result.outcome;
    retryFeedback = [result.message ?? `worker reported ${result.outcome}`];
    await appendEvent(workspaceDir, { type: "unit_attempt_failed", key: unitKey, outcome: result.outcome, usage: result.usage });
  }

  unit.status = "failed";
  await appendEvent(workspaceDir, { type: "unit_failed", key: unitKey });
  return "failed";
}

/** Run a standard stage, honoring the bounded revision loop: `max_rounds`
 *  re-runs the stage (fresh retry budget per round) until `stop_when`
 *  evaluates true against reports/metrics.json or the cap is hit. The
 *  manifest chooses whether an unmet cap is best-effort success or a release
 *  failure through `on_exhaustion`. */
async function runStandardStage(
  stage: StandardStage,
  opts: RunFlowOptions,
  state: FlowState,
): Promise<"succeeded" | "failed" | "paused"> {
  const spec = stageToSpec(stage);
  state.units[spec.key] ??= { status: "pending", attempts: 0, rounds: 0, approvalGranted: false, budgetApproved: false };
  const unit = state.units[spec.key];
  const maxRounds = stage.max_rounds ?? 1;
  let lastCurrent: number | undefined;

  while (unit.rounds < maxRounds) {
    const roundNumber = unit.rounds + 1;
    unit.attempts = 0; // fresh retry budget per round
    unit.status = "pending";
    const roundFeedback =
      roundNumber === 1
        ? undefined
        : stage.stop_when
          ? [
              `Revision round ${roundNumber} of ${maxRounds}: stop condition "${stage.stop_when}" ` +
              `not yet met${lastCurrent !== undefined ? ` (current: ${lastCurrent})` : ""}. ` +
              `Improve the outputs and update reports/metrics.json.`,
            ]
          : [`Revision round ${roundNumber} of ${maxRounds}: improve the previous round's outputs.`];

    const outcome = await runUnit(spec, opts, state, roundFeedback);
    if (outcome !== "succeeded") return outcome;
    unit.rounds += 1;

    if (stage.stop_when) {
      const evaluation = await evaluateStopCondition(opts.workspaceDir, stage.stop_when);
      lastCurrent = evaluation.current;
      if (evaluation.met) {
        await appendEvent(opts.workspaceDir, {
          type: "stop_condition_met", key: spec.key,
          rounds: unit.rounds, current: evaluation.current,
        });
        return "succeeded";
      }
      if (unit.rounds >= maxRounds) {
        await appendEvent(opts.workspaceDir, {
          type: "revision_rounds_exhausted", key: spec.key,
          rounds: unit.rounds, current: evaluation.current, condition: stage.stop_when,
          on_exhaustion: stage.on_exhaustion,
        });
        if (stage.on_exhaustion === "fail") {
          unit.status = "failed";
          unit.lastError = `Stop condition not met after ${unit.rounds} round(s): ${stage.stop_when} (current: ${evaluation.current ?? "missing"})`;
          await appendEvent(opts.workspaceDir, { type: "unit_failed", key: spec.key, reason: "stop_condition_unmet" });
          return "failed";
        }
        return "succeeded";
      }
    }
  }
  return "succeeded";
}

function stageToSpec(stage: StandardStage): WorkUnitSpec {
  return {
    key: stage.id,
    stageId: stage.id,
    title: stage.title,
    owner: stage.owner,
    inputs: stage.inputs,
    optional_inputs: stage.optional_inputs,
    outputs: stage.outputs,
    tools: stage.tools,
    allowed_tools: stage.allowed_tools,
    instructions: stage.instructions,
    skills: stage.skills,
    validators: stage.validators,
    validator_commands: stage.validator_commands,
    requires_human_approval: stage.requires_human_approval,
    retry: stage.retry,
    runtime: stage.runtime,
    model: stage.model,
    model_tier: stage.model_tier,
    command: stage.command,
    enabled: stage.enabled,
    skippable: stage.skippable,
    disabled_reason: stage.disabled_reason,
  };
}

function stepToSpec(stage: ForeachStage, step: WorkflowStep, itemId: string): WorkUnitSpec {
  const mapPath = (value: string) => resolveItemTemplates(value, stage.item_name, itemId);
  return {
    key: `${stage.id}.${step.id}[${itemId}]`,
    stageId: stage.id,
    stepId: step.id,
    itemId,
    title: step.title ?? stage.title,
    owner: step.owner,
    inputs: step.inputs.map(mapPath),
    optional_inputs: step.optional_inputs.map(mapPath),
    outputs: step.outputs.map(mapPath),
    tools: step.tools,
    allowed_tools: step.allowed_tools,
    instructions: step.instructions,
    skills: step.skills.map(mapPath),
    validators: step.validators,
    validator_commands: step.validator_commands,
    requires_human_approval: step.requires_human_approval,
    retry: step.retry,
    runtime: step.runtime,
    model: step.model,
    model_tier: step.model_tier,
    command: step.command,
    enabled: stage.enabled && step.enabled,
    skippable: stage.skippable || step.skippable,
    disabled_reason: !stage.enabled ? stage.disabled_reason : step.disabled_reason,
  };
}

async function markSkipped(
  workspaceDir: string,
  state: FlowState,
  key: string,
  reason: string | undefined,
): Promise<void> {
  state.units[key] ??= UnitState.parse({});
  const unit = state.units[key];
  if (unit.status === "skipped") return;
  unit.status = "skipped";
  unit.skipReason = reason ?? "disabled by workflow configuration";
  await appendEvent(workspaceDir, { type: "unit_skipped", key, reason: unit.skipReason });
}

function approvalId(spec: WorkUnitSpec, pendingCount: number): string {
  const suffix = String(pendingCount + 1).padStart(3, "0");
  if (spec.itemId && spec.stepId) return `approve-${spec.stageId}-${spec.stepId}-${spec.itemId}-${suffix}`;
  return `approve-${spec.stageId}-${suffix}`;
}

function queueApproval(state: FlowState, spec: WorkUnitSpec): void {
  if (state.pendingApprovals.some((a) =>
    a.stageId === spec.stageId && a.stepId === spec.stepId && a.itemId === spec.itemId
  )) {
    return;
  }
  state.units[spec.key].approvalGranted = false;
  state.pendingApprovals.push({
    id: approvalId(spec, state.pendingApprovals.length),
    kind: "human",
    stageId: spec.stageId,
    stepId: spec.stepId,
    itemId: spec.itemId,
    artifacts: concreteOutputs(spec.outputs),
  });
}

function approvalUnitKey(approval: { stageId: string; stepId?: string; itemId?: string }): string {
  if (approval.stepId && approval.itemId) return `${approval.stageId}.${approval.stepId}[${approval.itemId}]`;
  return approval.stageId;
}

function hasPendingApprovalForItem(state: FlowState, stageId: string, itemId: string): boolean {
  return state.pendingApprovals.some((a) => a.stageId === stageId && a.itemId === itemId);
}

function hasPendingApprovalForStage(state: FlowState, stageId: string): boolean {
  return state.pendingApprovals.some((a) => a.stageId === stageId);
}

async function ensureForeachExpansion(
  stage: ForeachStage,
  opts: RunFlowOptions,
  state: FlowState,
): Promise<string[]> {
  if (!state.foreachItems[stage.id]) {
    state.foreachItems[stage.id] = await expandForeachItems(stage, opts.workspaceDir);
    for (const itemId of state.foreachItems[stage.id]) {
      for (const step of stage.steps) {
        const key = `${stage.id}.${step.id}[${itemId}]`;
        if (!step.enabled) {
          await markSkipped(opts.workspaceDir, state, key, step.disabled_reason);
        } else {
          state.units[key] ??= { status: "pending", attempts: 0, rounds: 0, approvalGranted: false, budgetApproved: false };
        }
      }
    }
    await appendEvent(opts.workspaceDir, {
      type: "foreach_expanded",
      key: stage.id,
      items: state.foreachItems[stage.id],
    });
    await saveFlowState(opts.workspaceDir, state);
  }
  return state.foreachItems[stage.id];
}

function nextReadySpec(stage: ForeachStage, state: FlowState, running: Set<string>): WorkUnitSpec | null {
  const itemIds = state.foreachItems[stage.id] ?? [];
  for (const itemId of itemIds) {
    if (hasPendingApprovalForItem(state, stage.id, itemId)) continue;
    for (let i = 0; i < stage.steps.length; i += 1) {
      const step = stage.steps[i];
      const spec = stepToSpec(stage, step, itemId);
      const unit = state.units[spec.key];
      if (unit?.status === "succeeded" || unit?.status === "skipped") continue;
      if (unit?.status === "failed") break;
      if (running.has(spec.key)) break;
      if (i > 0) {
        const previous = stepToSpec(stage, stage.steps[i - 1], itemId);
        const previousUnit = state.units[previous.key];
        if (previousUnit?.status !== "succeeded" && previousUnit?.status !== "skipped") break;
        if (previous.requires_human_approval && !previousUnit.approvalGranted) break;
      }
      return spec;
    }
  }
  return null;
}

async function runForeachStage(
  stage: ForeachStage,
  opts: RunFlowOptions,
  state: FlowState,
  runtimeMaxConcurrent: number,
): Promise<StageOutcome> {
  if (!stage.enabled) {
    await markSkipped(opts.workspaceDir, state, stage.id, stage.disabled_reason);
    return "succeeded";
  }
  await ensureForeachExpansion(stage, opts, state);
  const stageUnit = state.units[stage.id];
  stageUnit.status = "running";
  const cap = Math.max(1, Math.min(stage.max_parallel, opts.workflow.max_parallel, runtimeMaxConcurrent));
  const running = new Map<string, Promise<{ spec: WorkUnitSpec; outcome: "succeeded" | "failed" | "paused" }>>();
  let pausing = false;

  while (true) {
    while (!pausing && running.size < cap) {
      const spec = nextReadySpec(stage, state, new Set(running.keys()));
      if (!spec) break;
      const promise = runUnit(spec, opts, state).then((outcome) => ({ spec, outcome }));
      running.set(spec.key, promise);
    }

    if (running.size === 0) break;

    const settled = await Promise.race(running.values());
    running.delete(settled.spec.key);

    if (settled.outcome === "paused") {
      pausing = true;
    } else if (settled.outcome === "succeeded" && settled.spec.requires_human_approval) {
      queueApproval(state, settled.spec);
      await appendEvent(opts.workspaceDir, { type: "flow_review_queued", key: settled.spec.key });
    }
    await saveFlowState(opts.workspaceDir, state);
  }

  if (pausing) {
    stageUnit.status = "pending";
    return "paused";
  }

  const itemIds = state.foreachItems[stage.id] ?? [];
  const anyFailed = itemIds.some((itemId) =>
    stage.steps.some((step) => state.units[`${stage.id}.${step.id}[${itemId}]`]?.status === "failed")
  );
  if (anyFailed) {
    stageUnit.status = "failed";
    return "failed";
  }

  if (hasPendingApprovalForStage(state, stage.id)) {
    stageUnit.status = "pending";
    return "awaiting_review";
  }

  const allSucceeded = itemIds.every((itemId) =>
    stage.steps.every((step) => {
      const status = state.units[`${stage.id}.${step.id}[${itemId}]`]?.status;
      return status === "succeeded" || status === "skipped";
    })
  );
  if (!allSucceeded) {
    stageUnit.status = "pending";
    return "awaiting_review";
  }

  stageUnit.status = "succeeded";
  await appendEvent(opts.workspaceDir, { type: "unit_succeeded", key: stage.id });
  return "succeeded";
}

function scopeExecutableStage(stage: ExecutableStage, scopedId: string): ExecutableStage {
  return { ...stage, id: scopedId } as ExecutableStage;
}

function ensureLoopRoundUnits(stage: LoopStage, state: FlowState, roundNumber: number): void {
  const roundPrefix = `${stage.id}-r${roundNumber}`;
  for (const child of stage.stages) {
    const key = `${roundPrefix}-${child.id}`;
    state.units[key] ??= {
      status: "pending",
      attempts: 0,
      rounds: 0,
      approvalGranted: false,
      budgetApproved: false,
    };
  }
}

async function runExecutableStage(
  stage: ExecutableStage,
  opts: RunFlowOptions,
  state: FlowState,
  runtimeMaxConcurrent: number,
): Promise<StageOutcome> {
  state.units[stage.id] ??= {
    status: "pending",
    attempts: 0,
    rounds: 0,
    approvalGranted: false,
    budgetApproved: false,
  };
  const unit = state.units[stage.id];
  if (unit.status === "succeeded" || unit.status === "skipped") return "succeeded";

  if (!stage.enabled) {
    await markSkipped(opts.workspaceDir, state, stage.id, stage.disabled_reason);
    return "succeeded";
  }

  if (state.pendingApprovals.length > 0) return "awaiting_review";

  if (needsBudgetApproval(stage, opts.workflow) && !unit.budgetApproved) {
    queueBudgetApproval(state, stage.id);
    await appendEvent(opts.workspaceDir, { type: "flow_paused_budget_approval", key: stage.id });
    return "awaiting_review";
  }

  unit.status = "pending";
  const outcome = "steps" in stage
    ? await runForeachStage(stage, opts, state, runtimeMaxConcurrent)
    : await runStandardStage(stage, opts, state);

  if (outcome === "succeeded" && !("steps" in stage) && stage.requires_human_approval) {
    queueApproval(state, stageToSpec(stage));
    await appendEvent(opts.workspaceDir, { type: "flow_paused_approval", key: stage.id });
    return "awaiting_review";
  }

  return outcome;
}

async function runLoopStage(
  stage: LoopStage,
  opts: RunFlowOptions,
  state: FlowState,
  runtimeMaxConcurrent: number,
): Promise<StageOutcome> {
  state.units[stage.id] ??= {
    status: "pending",
    attempts: 0,
    rounds: 0,
    approvalGranted: false,
    budgetApproved: false,
  };
  const unit = state.units[stage.id];
  if (unit.status === "succeeded" || unit.status === "skipped") return "succeeded";
  if (!stage.enabled) {
    await markSkipped(opts.workspaceDir, state, stage.id, stage.disabled_reason);
    return "succeeded";
  }
  unit.status = "running";

  let lastCurrent: number | undefined;
  const scoreTrace: number[] = [];
  while (unit.rounds < stage.max_rounds) {
    const roundNumber = unit.rounds + 1;
    const roundPrefix = `${stage.id}-r${roundNumber}`;
    ensureLoopRoundUnits(stage, state, roundNumber);
    await appendEvent(opts.workspaceDir, {
      type: "loop_round_started",
      key: stage.id,
      round: roundNumber,
      maxRounds: stage.max_rounds,
    });

    for (const child of stage.stages) {
      const scoped = scopeExecutableStage(child, `${roundPrefix}-${child.id}`);
      const outcome = await runExecutableStage(scoped, opts, state, runtimeMaxConcurrent);
      await saveFlowState(opts.workspaceDir, state);

      if (outcome === "failed") {
        // A child that exhausts retries (typically validation) fails the
        // WHOLE flow only when no rounds remain — otherwise the next round
        // is the retry: findings are already in reports/validation.md and
        // routing, where the reviser reads them. Flagship3 lesson: rebuild
        // sits after revise, so its feedback must flow forward, not abort.
        if (unit.rounds + 1 < stage.max_rounds) {
          await appendEvent(opts.workspaceDir, {
            type: "loop_child_failed_continuing", key: scoped.id,
            round: roundNumber, remainingRounds: stage.max_rounds - unit.rounds - 1,
          });
          break; // end this round; the round-complete logic advances the loop
        }
        unit.status = "failed";
        return "failed";
      }
      if (outcome === "paused") {
        unit.status = "pending";
        return "paused";
      }
      if (outcome === "awaiting_review") {
        unit.status = "pending";
        return "awaiting_review";
      }
    }

    unit.rounds += 1;
    await appendEvent(opts.workspaceDir, {
      type: "loop_round_completed",
      key: stage.id,
      round: unit.rounds,
    });

    if (stage.stop_when) {
      const evaluation = await evaluateStopCondition(opts.workspaceDir, stage.stop_when);
      lastCurrent = evaluation.current;
      if (evaluation.met) {
        unit.status = "succeeded";
        await appendEvent(opts.workspaceDir, {
          type: "stop_condition_met",
          key: stage.id,
          rounds: unit.rounds,
          current: evaluation.current,
        });
        return "succeeded";
      }

      // Stagnation: N consecutive rounds each improving the watched metric by
      // less than min_delta means further rewriting will not reach the target.
      // Stop rather than burn the remaining rounds (AutoResearch's Δ rule).
      if (stage.stop_on_stagnation && evaluation.current !== undefined) {
        scoreTrace.push(evaluation.current);
        const need = stage.stop_on_stagnation.consecutive_rounds;
        const minDelta = stage.stop_on_stagnation.min_delta;
        if (scoreTrace.length > need) {
          const recent = scoreTrace.slice(-(need + 1));
          const stagnant = recent.slice(1).every((score, i) => score - recent[i] < minDelta);
          if (stagnant) {
            const onStagnation = stage.stop_on_stagnation.on_stagnation ?? stage.on_exhaustion;
            await appendEvent(opts.workspaceDir, {
              type: "loop_stagnated",
              key: stage.id,
              rounds: unit.rounds,
              current: evaluation.current,
              trace: recent,
              min_delta: minDelta,
              consecutive_rounds: need,
              on_stagnation: onStagnation,
            });
            const reportPath = resolveWithin(path.join(opts.workspaceDir, "reports"), `${stage.id}-stagnation.md`);
            await fs.mkdir(path.dirname(reportPath), { recursive: true });
            await fs.writeFile(reportPath,
              `# Loop stagnation: ${stage.id}\n\nThe watched metric plateaued: ` +
              `${recent.map((s) => s.toFixed(2)).join(" -> ")} ` +
              `(< ${minDelta} gain for ${need} rounds), still below the target ` +
              `"${stage.stop_when}". Rewriting stopped rather than spending the ` +
              `remaining ${stage.max_rounds - unit.rounds} round(s). ` +
              (onStagnation === "fail"
                ? "Release fails: expand the corpus/evidence or lower the target, then re-run."
                : "Proceeding with the best result so far.") + "\n",
              "utf-8");
            if (onStagnation === "fail") {
              unit.status = "failed";
              unit.lastError = `Loop "${stage.id}" stagnated below ${stage.stop_when} (${recent.map((s) => s.toFixed(2)).join(" -> ")})`;
              return "failed";
            }
            unit.status = "succeeded";
            return "succeeded";
          }
        }
      }

      if (unit.rounds >= stage.max_rounds) {
        await appendEvent(opts.workspaceDir, {
          type: "revision_rounds_exhausted",
          key: stage.id,
          rounds: unit.rounds,
          current: lastCurrent,
          condition: stage.stop_when,
          on_exhaustion: stage.on_exhaustion,
        });
        if (stage.on_exhaustion === "fail") {
          unit.status = "failed";
          unit.lastError = `Stop condition not met after ${unit.rounds} round(s): ${stage.stop_when} (current: ${lastCurrent ?? "missing"})`;
          await appendEvent(opts.workspaceDir, { type: "unit_failed", key: stage.id, reason: "stop_condition_unmet" });
          return "failed";
        }
        unit.status = "succeeded";
        return "succeeded";
      }
    }
  }

  unit.status = "succeeded";
  await appendEvent(opts.workspaceDir, { type: "unit_succeeded", key: stage.id });
  return "succeeded";
}

/** One flow run per workspace: acquire the shared lock for the duration. */
export async function runFlow(opts: RunFlowOptions): Promise<FlowState> {
  const lock = await acquireFlowLock(opts.workspaceDir, opts.lockHolder ?? "cli");
  try {
    return await runFlowUnlocked(opts);
  } finally {
    await releaseFlowLock(opts.workspaceDir, lock);
  }
}

export async function runFlowUnlocked(opts: RunFlowOptions): Promise<FlowState> {
  const { workflow, workspaceDir } = opts;

  const mismatches = findCapabilityMismatches(workflow, opts.runtime.id);
  if (mismatches.length > 0) {
    throw new Error(
      "Stage/runtime capability mismatches (fix the manifest or pick another --runtime):\n" +
      mismatches.map((m) => `  - ${m}`).join("\n"),
    );
  }

  const health = await opts.runtime.checkAvailable();
  if (!health.available) {
    throw new Error(`Runtime "${opts.runtime.id}" is not available${health.detail ? `: ${health.detail}` : ""}`);
  }
  const runtimeMaxConcurrent = health.max_concurrent ?? Number.POSITIVE_INFINITY;

  // --reset is an explicit user request to start the whole graph again. It
  // must not depend on a manifest-hash change; otherwise a stopped or
  // partially completed run cannot re-execute corrected deterministic stages.
  let state = opts.reset ? null : await loadFlowState(workspaceDir);
  if (state && state.workflowHash !== workflowHash(workflow)) {
    if (!opts.reset) {
      throw new Error(
        "The workflow definition changed since this flow started. " +
        "Re-run with reset to start fresh (artifacts are kept; state is reinitialized).",
      );
    }
    state = null;
  }
  if (!state) {
    state = await initFlowState(workflow, workspaceDir);
    await appendEvent(workspaceDir, { type: "flow_initialized" });
  }
  if (state.status === "completed") return state;

  state.status = "running";
  await saveFlowState(workspaceDir, state);

  for (const stage of workflow.stages) {
    const unit = state.units[stage.id];
    if (unit.status === "succeeded" || unit.status === "skipped") continue;

    if (state.pendingApprovals.length > 0) {
      state.status = "paused_for_approval";
      await saveFlowState(workspaceDir, state);
      return state;
    }

    const outcome = "stages" in stage
      ? await runLoopStage(stage, opts, state, runtimeMaxConcurrent)
      : await runExecutableStage(stage, opts, state, runtimeMaxConcurrent);
    await saveFlowState(workspaceDir, state);

    if (outcome === "failed") {
      state.status = "failed";
      await appendEvent(workspaceDir, { type: "flow_failed", key: stage.id });
      await saveFlowState(workspaceDir, state);
      return state;
    }
    if (outcome === "paused") {
      state.status = "paused_blocker";
      await saveFlowState(workspaceDir, state);
      return state;
    }

    if (outcome === "awaiting_review") {
      state.status = "paused_for_approval";
      await appendEvent(workspaceDir, { type: "flow_paused_approval", key: stage.id });
      await saveFlowState(workspaceDir, state);
      return state;
    }
  }

  state.status = "completed";
  await appendEvent(workspaceDir, { type: "flow_completed" });
  await saveFlowState(workspaceDir, state);
  return state;
}

export async function approveFlow(workspaceDir: string, approvalId: string): Promise<FlowState> {
  const state = await loadFlowState(workspaceDir);
  if (!state) throw new Error("No flow state found. Run `malaclaw flow run` first.");
  const index = state.pendingApprovals.findIndex((a) => a.id === approvalId);
  if (index === -1) {
    throw new Error(
      `Approval "${approvalId}" not found. Pending: ${state.pendingApprovals.map((a) => a.id).join(", ") || "none"}`,
    );
  }
  const [approval] = state.pendingApprovals.splice(index, 1);
  const unit = state.units[approvalUnitKey(approval)];
  if (unit) {
    if (approval.kind === "budget") unit.budgetApproved = true;
    else unit.approvalGranted = true;
  }
  if (state.pendingApprovals.length === 0 && state.status === "paused_for_approval") {
    state.status = "idle";
  }
  await appendEvent(workspaceDir, { type: "approval_granted", key: approvalId });
  await saveFlowState(workspaceDir, state);
  return state;
}

export async function approveAllFlow(workspaceDir: string): Promise<FlowState> {
  const state = await loadFlowState(workspaceDir);
  if (!state) throw new Error("No flow state found. Run `malaclaw flow run` first.");
  const approvals = [...state.pendingApprovals];
  state.pendingApprovals = [];
  for (const approval of approvals) {
    const unit = state.units[approvalUnitKey(approval)];
    if (unit) {
      if (approval.kind === "budget") unit.budgetApproved = true;
      else unit.approvalGranted = true;
    }
  }
  if (state.status === "paused_for_approval") {
    state.status = "idle";
  }
  await appendEvent(workspaceDir, {
    type: "approvals_granted_batch",
    approvals: approvals.map((a) => a.id),
  });
  await saveFlowState(workspaceDir, state);
  return state;
}

/**
 * An explicit operator retry is different from a workflow reset: preserve all
 * succeeded units and artifacts, but make only exhausted failed units runnable
 * again. This is for cleared external conditions such as a repaired runtime,
 * restored credentials, or a sandbox/permission failure.
 */
export async function retryFailedFlow(workspaceDir: string): Promise<FlowState> {
  const state = await loadFlowState(workspaceDir);
  if (!state) throw new Error("No flow state found. Run `malaclaw flow run` first.");
  if (state.status !== "failed") {
    throw new Error(`Flow is ${state.status}; only a failed flow needs an explicit retry.`);
  }
  const retried: string[] = [];
  for (const [key, unit] of Object.entries(state.units)) {
    if (unit.status !== "failed") continue;
    unit.status = "pending";
    unit.attempts = 0;
    delete unit.lastOutcome;
    delete unit.lastError;
    delete unit.retryAt;
    retried.push(key);
  }
  if (retried.length === 0) throw new Error("Flow is failed but has no failed units to retry.");
  state.status = "idle";
  await appendEvent(workspaceDir, { type: "flow_retry_requested", keys: retried });
  await saveFlowState(workspaceDir, state);
  return state;
}

/** Adopt an additive workflow definition without discarding completed work.
 *
 * This is intentionally conservative: existing unit records are immutable,
 * removed stages are retained in history, and only new top-level stages gain
 * pending state. Operators use it after a backward-compatible manifest update
 * (for example, adding a final validation stage), never as a substitute for
 * --reset after changing the meaning of completed stages. */
export async function migrateFlow(workspaceDir: string, workflow: WorkflowDef): Promise<FlowState> {
  const state = await loadFlowState(workspaceDir);
  if (!state) throw new Error("No flow state found. Run `malaclaw flow run` first.");
  if (state.status === "running") {
    throw new Error("Cannot migrate a running flow. Wait for it to pause or finish first.");
  }
  const nextHash = workflowHash(workflow);
  if (state.workflowHash === nextHash) return state;

  const added: string[] = [];
  for (const stage of workflow.stages) {
    if (state.units[stage.id]) continue;
    state.units[stage.id] = UnitState.parse({});
    added.push(stage.id);
  }
  const previousHash = state.workflowHash;
  state.workflowHash = nextHash;
  if (state.status === "completed" && added.length > 0) state.status = "idle";
  await appendEvent(workspaceDir, {
    type: "flow_migrated",
    from_workflow_hash: previousHash,
    to_workflow_hash: nextHash,
    added_units: added,
  });
  await saveFlowState(workspaceDir, state);
  return state;
}

/** Re-run a top-level stage and everything after it while preserving earlier
 * completed work. This is the deliberate repair path after an artifact or
 * validator contract changes; it is narrower than --reset and explicit about
 * which work may incur new runtime cost. */
export async function reopenFlowFrom(workspaceDir: string, workflow: WorkflowDef, stageId: string): Promise<FlowState> {
  const state = await loadFlowState(workspaceDir);
  if (!state) throw new Error("No flow state found. Run `malaclaw flow run` first.");
  if (state.status === "running") throw new Error("Cannot reopen a running flow. Wait for it to pause or finish first.");
  if (state.workflowHash !== workflowHash(workflow)) {
    throw new Error("Workflow definition changed; run `malaclaw flow migrate` before reopening stages.");
  }
  const start = workflow.stages.findIndex((stage) => stage.id === stageId);
  if (start === -1) throw new Error(`Unknown top-level stage "${stageId}".`);
  const reopened = workflow.stages.slice(start).map((stage) => stage.id);
  const belongsTo = (key: string, id: string) => key === id || key.startsWith(`${id}.`) || key.startsWith(`${id}-`);
  for (const id of reopened) {
    state.units[id] = UnitState.parse({});
    for (const key of Object.keys(state.units)) {
      if (key !== id && belongsTo(key, id)) delete state.units[key];
    }
    delete state.foreachItems[id];
  }
  const reopenedSet = new Set(reopened);
  state.pendingApprovals = state.pendingApprovals.filter((approval) => !reopenedSet.has(approval.stageId));
  state.status = "idle";
  await appendEvent(workspaceDir, { type: "flow_reopened", from_stage: stageId, stages: reopened });
  await saveFlowState(workspaceDir, state);
  return state;
}

export async function getFlowStatus(workspaceDir: string): Promise<FlowState | null> {
  return loadFlowState(workspaceDir);
}
