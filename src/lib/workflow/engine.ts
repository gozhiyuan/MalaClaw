import fs from "node:fs/promises";
import path from "node:path";
import type { ForeachStage, StandardStage, WorkflowCommand, WorkflowDef, WorkflowStep } from "../schema.js";
import {
  appendEvent,
  checkpointsDir,
  initFlowState,
  loadFlowState,
  promptsDir,
  logsDir,
  saveFlowState,
  workflowHash,
  type FlowState,
} from "./state.js";
import { expandForeachItems, resolveItemTemplates } from "./foreach.js";
import { resolveWithin } from "./safe-paths.js";
import { renderUnitPrompt } from "./prompt.js";
import { runValidators } from "./validators.js";
import { getWorkerRuntime } from "./runtimes/registry.js";
import type { StageRunResult, WorkerRuntime } from "./runtimes/base.js";

export type RunFlowOptions = {
  workflow: WorkflowDef;
  workspaceDir: string;
  runtime: WorkerRuntime;
  /** Re-initialize state when the workflow definition changed. */
  reset?: boolean;
  /** Backoff between rate-limited retries (tests use 0). */
  backoffMs?: number;
};

const MAX_BACKOFFS = 5;
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
  validators: string[];
  validator_commands: WorkflowCommand[];
  requires_human_approval?: boolean;
  retry?: { max_attempts: number };
  runtime?: string;
  model?: string;
  model_tier?: string;
  command?: { cmd: string; args: string[] };
  stageId: string;
  stepId?: string;
  itemId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function concreteOutputs(outputs: string[]): string[] {
  return outputs.filter((o) => !o.includes("*") && !o.includes("{{"));
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

/** Run one unit to a terminal outcome: succeeded, failed, or paused. */
async function runUnit(
  spec: WorkUnitSpec,
  opts: RunFlowOptions,
  state: FlowState,
): Promise<"succeeded" | "failed" | "paused"> {
  const { workspaceDir, workflow, runtime } = opts;
  const unitKey = spec.key;
  state.units[unitKey] ??= { status: "pending", attempts: 0, approvalGranted: false };
  const unit = state.units[unitKey];
  const maxAttempts = spec.retry?.max_attempts ?? 2;
  const requestedRuntimeId = resolveRuntimeId(spec, workflow, runtime.id);
  const unitRuntime = requestedRuntimeId === runtime.id ? runtime : getWorkerRuntime(requestedRuntimeId);
  unit.requestedRuntime = requestedRuntimeId;
  unit.actualRuntime = unitRuntime.id;

  await checkpointOutputs(workspaceDir, unitKey, spec.outputs);

  let retryFeedback: string[] | undefined;
  let backoffs = 0;

  while (unit.attempts < maxAttempts) {
    unit.attempts += 1;
    unit.status = "running";
    await appendEvent(workspaceDir, {
      type: "unit_started", key: unitKey, attempt: unit.attempts,
      requestedRuntime: requestedRuntimeId, actualRuntime: unitRuntime.id,
    });

    const prompt = renderUnitPrompt({ stage: spec, unitKey, retryFeedback });
    await fs.mkdir(promptsDir(workspaceDir), { recursive: true });
    const promptPath = resolveWithin(promptsDir(workspaceDir), `${unitKey}-attempt${unit.attempts}.md`);
    const logPath = resolveWithin(logsDir(workspaceDir), `${unitKey}-attempt${unit.attempts}.log`);
    await fs.writeFile(promptPath, prompt, "utf-8");

    let result = await unitRuntime.runStage({
      owner: spec.owner, instructions: prompt,
      workspaceDir, unitKey,
      outputs: spec.outputs, timeoutMs: 600_000,
      command: spec.command,
      model: resolveModel(spec, workflow), promptPath, logPath,
    });

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
      result = await unitRuntime.runStage({
        workspaceDir, unitKey, owner: spec.owner, instructions: prompt,
        outputs: spec.outputs, timeoutMs: 600_000,
        command: spec.command,
        model: resolveModel(spec, workflow), promptPath, logPath,
      });
    }

    unit.lastOutcome = result.outcome;

    if (PAUSE_OUTCOMES.has(result.outcome)) {
      unit.status = "pending"; // re-runnable once the blocker clears
      unit.attempts -= 1; // the blocked attempt does not count
      await writeBlocker(workspaceDir, unitKey, result);
      await appendEvent(workspaceDir, { type: "flow_paused_blocker", key: unitKey, outcome: result.outcome });
      return "paused";
    }

    if (result.outcome === "success") {
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
        type: "unit_validation_failed", key: unitKey, findings: report.findings,
      });
      continue;
    }

    // worker_error / timeout / validation_failed from the runtime itself
    unit.lastError = result.message ?? result.outcome;
    retryFeedback = [result.message ?? `worker reported ${result.outcome}`];
    await appendEvent(workspaceDir, { type: "unit_attempt_failed", key: unitKey, outcome: result.outcome });
  }

  unit.status = "failed";
  await appendEvent(workspaceDir, { type: "unit_failed", key: unitKey });
  return "failed";
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
    validators: stage.validators,
    validator_commands: stage.validator_commands,
    requires_human_approval: stage.requires_human_approval,
    retry: stage.retry,
    runtime: stage.runtime,
    model: stage.model,
    model_tier: stage.model_tier,
    command: stage.command,
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
    validators: step.validators,
    validator_commands: step.validator_commands,
    requires_human_approval: step.requires_human_approval,
    retry: step.retry,
    runtime: step.runtime,
    model: step.model,
    model_tier: step.model_tier,
    command: step.command,
  };
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
        state.units[key] ??= { status: "pending", attempts: 0, approvalGranted: false };
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
      if (unit?.status === "succeeded") continue;
      if (unit?.status === "failed") break;
      if (running.has(spec.key)) break;
      if (i > 0) {
        const previous = stepToSpec(stage, stage.steps[i - 1], itemId);
        const previousUnit = state.units[previous.key];
        if (previousUnit?.status !== "succeeded") break;
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
): Promise<"succeeded" | "failed" | "paused" | "awaiting_review"> {
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
    stage.steps.every((step) => state.units[`${stage.id}.${step.id}[${itemId}]`]?.status === "succeeded")
  );
  if (!allSucceeded) {
    stageUnit.status = "pending";
    return "awaiting_review";
  }

  stageUnit.status = "succeeded";
  await appendEvent(opts.workspaceDir, { type: "unit_succeeded", key: stage.id });
  return "succeeded";
}

export async function runFlow(opts: RunFlowOptions): Promise<FlowState> {
  const { workflow, workspaceDir } = opts;

  let state = await loadFlowState(workspaceDir);
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
  const health = await opts.runtime.checkAvailable();
  const runtimeMaxConcurrent = health.max_concurrent ?? Number.POSITIVE_INFINITY;

  for (const stage of workflow.stages) {
    const unit = state.units[stage.id];
    if (unit.status === "succeeded") continue;

    if (state.pendingApprovals.length > 0) {
      state.status = "paused_for_approval";
      await saveFlowState(workspaceDir, state);
      return state;
    }

    unit.status = "pending";
    const outcome = "steps" in stage
      ? await runForeachStage(stage, opts, state, runtimeMaxConcurrent)
      : await runUnit(stageToSpec(stage), opts, state);
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

    if (!("steps" in stage) && stage.requires_human_approval) {
      queueApproval(state, stageToSpec(stage));
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
  if (unit) unit.approvalGranted = true;
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
    if (unit) unit.approvalGranted = true;
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

export async function getFlowStatus(workspaceDir: string): Promise<FlowState | null> {
  return loadFlowState(workspaceDir);
}
