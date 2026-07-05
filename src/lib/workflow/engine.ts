import fs from "node:fs/promises";
import path from "node:path";
import type { StandardStage, WorkflowDef } from "../schema.js";
import {
  appendEvent,
  checkpointsDir,
  initFlowState,
  loadFlowState,
  promptsDir,
  saveFlowState,
  workflowHash,
  type FlowState,
} from "./state.js";
import { renderUnitPrompt } from "./prompt.js";
import { runValidators } from "./validators.js";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function concreteOutputs(outputs: string[]): string[] {
  return outputs.filter((o) => !o.includes("*") && !o.includes("{{"));
}

function resolveRuntimeId(stage: StandardStage, workflow: WorkflowDef, fallback: string): string {
  if (stage.runtime) return stage.runtime;
  if (stage.model_tier && workflow.model_tiers?.[stage.model_tier]) {
    return workflow.model_tiers[stage.model_tier].runtime;
  }
  return workflow.runtime_policy?.primary ?? fallback;
}

function resolveModel(stage: StandardStage, workflow: WorkflowDef): string | undefined {
  if (stage.model) return stage.model;
  if (stage.model_tier) return workflow.model_tiers?.[stage.model_tier]?.model;
  return undefined;
}

async function checkpointOutputs(workspaceDir: string, unitKey: string, outputs: string[]): Promise<void> {
  const existing: string[] = [];
  for (const output of concreteOutputs(outputs)) {
    try {
      await fs.access(path.join(workspaceDir, output));
      existing.push(output);
    } catch {
      // nothing to checkpoint
    }
  }
  if (existing.length === 0) return;
  const dir = path.join(
    checkpointsDir(workspaceDir),
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${unitKey}`,
  );
  for (const output of existing) {
    const dest = path.join(dir, output);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(workspaceDir, output), dest);
  }
}

async function writeBlocker(
  workspaceDir: string, unitKey: string, result: StageRunResult,
): Promise<void> {
  const reportPath = path.join(workspaceDir, "reports", `${unitKey}-blocker.md`);
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
  stage: StandardStage,
  opts: RunFlowOptions,
  state: FlowState,
): Promise<"succeeded" | "failed" | "paused"> {
  const { workspaceDir, workflow, runtime } = opts;
  const unitKey = stage.id;
  const unit = state.units[unitKey];
  const maxAttempts = stage.retry?.max_attempts ?? 2;
  const requestedRuntimeId = resolveRuntimeId(stage, workflow, runtime.id);
  unit.requestedRuntime = requestedRuntimeId;
  // M2a: the caller supplies one runtime instance; record divergence rather
  // than silently swapping. Real multi-runtime dispatch arrives with M7.
  unit.actualRuntime = runtime.id;

  await checkpointOutputs(workspaceDir, unitKey, stage.outputs);

  let retryFeedback: string[] | undefined;
  let backoffs = 0;

  while (unit.attempts < maxAttempts) {
    unit.attempts += 1;
    unit.status = "running";
    await appendEvent(workspaceDir, {
      type: "unit_started", key: unitKey, attempt: unit.attempts,
      requestedRuntime: requestedRuntimeId, actualRuntime: runtime.id,
    });

    const prompt = renderUnitPrompt({ stage, unitKey, retryFeedback });
    await fs.mkdir(promptsDir(workspaceDir), { recursive: true });
    const promptPath = path.join(promptsDir(workspaceDir), `${unitKey}-attempt${unit.attempts}.md`);
    await fs.writeFile(promptPath, prompt, "utf-8");

    let result = await runtime.runStage({
      workspaceDir, unitKey, owner: stage.owner, instructions: prompt,
      outputs: stage.outputs, timeoutMs: 600_000,
      model: resolveModel(stage, workflow), promptPath,
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
      result = await runtime.runStage({
        workspaceDir, unitKey, owner: stage.owner, instructions: prompt,
        outputs: stage.outputs, timeoutMs: 600_000,
        model: resolveModel(stage, workflow), promptPath,
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
      const report = await runValidators(stage.validators, stage.outputs, workspaceDir);
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

export async function runFlow(opts: RunFlowOptions): Promise<FlowState> {
  const { workflow, workspaceDir } = opts;

  for (const stage of workflow.stages) {
    if ("steps" in stage) {
      throw new Error(
        `Stage "${stage.id}" is a foreach stage — foreach scheduling arrives in the next milestone (M2b)`,
      );
    }
  }

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

  for (const stage of workflow.stages) {
    const unit = state.units[stage.id];
    if (unit.status === "succeeded") continue;

    if (state.pendingApprovals.length > 0) {
      state.status = "paused_for_approval";
      await saveFlowState(workspaceDir, state);
      return state;
    }

    unit.status = "pending";
    const outcome = await runUnit(stage as StandardStage, opts, state);
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

    if ((stage as StandardStage).requires_human_approval) {
      state.pendingApprovals.push({
        id: `approve-${stage.id}-${String(state.pendingApprovals.length + 1).padStart(3, "0")}`,
        stageId: stage.id,
        artifacts: concreteOutputs((stage as StandardStage).outputs),
      });
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
  state.pendingApprovals.splice(index, 1);
  if (state.pendingApprovals.length === 0 && state.status === "paused_for_approval") {
    state.status = "idle";
  }
  await appendEvent(workspaceDir, { type: "approval_granted", key: approvalId });
  await saveFlowState(workspaceDir, state);
  return state;
}

export async function getFlowStatus(workspaceDir: string): Promise<FlowState | null> {
  return loadFlowState(workspaceDir);
}
