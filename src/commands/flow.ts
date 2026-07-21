import { loadManifest } from "../lib/loader.js";
import { spawn } from "node:child_process";
import { resolveManifest } from "../lib/resolver.js";
import { readEvents } from "../lib/workflow/state.js";
import { runFlow, approveFlow, approveAllFlow, cancelFlow, recoverOrphanedFlow, getFlowStatus, pauseFlow, resumeFlow, retryFailedFlow, migrateFlow, reopenFlowFrom } from "../lib/workflow/engine.js";
import { getWorkerRuntime, listWorkerRuntimes } from "../lib/workflow/runtimes/registry.js";
import { runRuntimeSmoke } from "../lib/workflow/runtime-smoke.js";
import { isFlowLockAlive, readFlowLock } from "../lib/workflow/lock.js";

export async function runFlowRun(opts: { runtime?: string; reset?: boolean }): Promise<void> {
  const workspaceDir = process.cwd();
  const manifest = await loadManifest(workspaceDir);
  const resolved = await resolveManifest(manifest, { projectDir: workspaceDir });
  if (!resolved.workflow) {
    console.log("No workflow: section in malaclaw.yaml — nothing to run.");
    process.exit(1);
  }
  for (const w of resolved.workflowWarnings) console.log(`⚠ ${w}`);

  const runtime = getWorkerRuntime(opts.runtime ?? resolved.workflow.runtime_policy?.primary ?? "dry-run");
  const health = await runtime.checkAvailable();
  if (!health.available) {
    console.log(`✗ Runtime "${runtime.id}" is not available${health.detail ? `: ${health.detail}` : ""}`);
    process.exit(1);
  }

  const state = await runFlow({ workflow: resolved.workflow, workspaceDir, runtime, reset: opts.reset });
  printState(state);
  await printUsageSummary(workspaceDir);
  if (state.status === "failed") process.exit(1);
}

export async function runFlowStatus(): Promise<void> {
  const state = await getFlowStatus(process.cwd());
  if (!state) {
    console.log("No flow state. Run: malaclaw flow run");
    return;
  }
  printState(state);
  if (state.status === "running" && !(await isFlowLockAlive(process.cwd()))) {
    const lock = await readFlowLock(process.cwd());
    console.log(`\n⚠ Flow appears orphaned: ${lock ? `scheduler pid ${lock.pid} is not alive` : "no scheduler lock exists"}.`);
    console.log("  No new work is running. Inspect logs, then use `malaclaw flow recover-orphan --yes` to preserve completed checkpoints and make the interrupted unit pending.");
  }
  await printUsageSummary(process.cwd());
}

export async function runFlowApprove(approvalId: string): Promise<void> {
  const state = await approveFlow(process.cwd(), approvalId);
  console.log(`✓ Approved ${approvalId}`);
  printState(state);
}

export async function runFlowReviewBatch(): Promise<void> {
  const state = await approveAllFlow(process.cwd());
  console.log("✓ Approved all pending review items");
  printState(state);
}

export async function runFlowPause(): Promise<void> {
  const state = await pauseFlow(process.cwd());
  console.log("✓ Pause requested. The in-flight unit may finish; no new unit will start.");
  printState(state);
}

export async function runFlowCancel(): Promise<void> {
  const state = await cancelFlow(process.cwd());
  console.log("✓ Cancellation requested. In-flight CLI work is terminated; run `flow resume` to retry its pending unit.");
  printState(state);
}

export async function runFlowRecoverOrphan(): Promise<void> {
  const state = await recoverOrphanedFlow(process.cwd());
  console.log("✓ Recovered orphaned running unit(s). Completed checkpoints are preserved.");
  printState(state);
}

export async function runFlowResume(opts: { runtime?: string }): Promise<void> {
  const state = await resumeFlow(process.cwd());
  console.log("✓ Operator control cleared; resuming from preserved state.");
  printState(state);
  await runFlowRun({ runtime: opts.runtime });
}

export async function runFlowRetry(): Promise<void> {
  const before = await getFlowStatus(process.cwd());
  const retried = before
    ? Object.entries(before.units).filter(([, unit]) => unit.status === "failed").map(([key]) => key)
    : [];
  const state = await retryFailedFlow(process.cwd());
  console.log(`✓ Reset failed unit(s) for retry: ${retried.join(", ")}`);
  printState(state);
}

export async function runFlowMigrate(): Promise<void> {
  const workspaceDir = process.cwd();
  const manifest = await loadManifest(workspaceDir);
  const resolved = await resolveManifest(manifest, { projectDir: workspaceDir });
  if (!resolved.workflow) {
    console.log("No workflow: section in malaclaw.yaml — nothing to migrate.");
    process.exit(1);
  }
  const state = await migrateFlow(workspaceDir, resolved.workflow);
  console.log("✓ Flow state migrated to the current workflow definition");
  printState(state);
}

export async function runFlowReopen(stageId: string): Promise<void> {
  const workspaceDir = process.cwd();
  const manifest = await loadManifest(workspaceDir);
  const resolved = await resolveManifest(manifest, { projectDir: workspaceDir });
  if (!resolved.workflow) {
    console.log("No workflow: section in malaclaw.yaml — nothing to reopen.");
    process.exit(1);
  }
  const state = await reopenFlowFrom(workspaceDir, resolved.workflow, stageId);
  console.log(`✓ Reopened ${stageId} and downstream stages`);
  printState(state);
}

export async function runFlowOperatorBrief(): Promise<void> {
  const { renderOperatorBrief } = await import("../lib/workflow/operator-brief.js");
  process.stdout.write(await renderOperatorBrief(process.cwd()));
}

export async function runFlowReport(): Promise<void> {
  const state = await getFlowStatus(process.cwd());
  if (!state || state.pendingApprovals.length === 0) {
    console.log("No pending approvals.");
    return;
  }
  console.log("# Pending review\n");
  for (const approval of state.pendingApprovals) {
    const scope = [
      `stage: ${approval.stageId}`,
      approval.stepId ? `step: ${approval.stepId}` : null,
      approval.itemId ? `item: ${approval.itemId}` : null,
    ].filter(Boolean).join(", ");
    console.log(`- ${approval.id} (${scope})`);
    for (const artifact of approval.artifacts) console.log(`    artifact: ${artifact}`);
    console.log(`    approve with: malaclaw flow approve ${approval.id}`);
  }
  console.log("\nBatch approve with: malaclaw flow review --batch");
}

export async function runFlowSupervise(opts: {
  runtime?: string;
  retryMinutes: number;
  maxRetryMinutes: number;
  maxHours: number;
  detach?: boolean;
}): Promise<void> {
  const workspaceDir = process.cwd();
  const manifest = await loadManifest(workspaceDir);
  const resolved = await resolveManifest(manifest, { projectDir: workspaceDir });
  if (!resolved.workflow) {
    console.log("No workflow: section in malaclaw.yaml — nothing to supervise.");
    process.exit(1);
  }
  const runtime = getWorkerRuntime(opts.runtime ?? resolved.workflow.runtime_policy?.primary ?? "dry-run");
  const health = await runtime.checkAvailable();
  if (!health.available) {
    console.log(`✗ Runtime "${runtime.id}" is not available${health.detail ? `: ${health.detail}` : ""}`);
    process.exit(1);
  }
  if (opts.detach) {
    // A detached Node child survives the invoking terminal/tool process. The
    // child deliberately runs the normal foreground supervisor, so there is
    // one implementation of retry/approval semantics and one lock owner.
    const child = spawn(
      process.execPath,
      [
        process.argv[1], "flow", "supervise",
        "--runtime", runtime.id,
        "--retry-minutes", String(opts.retryMinutes),
        "--max-retry-minutes", String(opts.maxRetryMinutes),
        "--max-hours", String(opts.maxHours),
      ],
      { cwd: workspaceDir, detached: true, stdio: "ignore", env: process.env },
    );
    child.unref();
    console.log(`✓ Started detached supervisor (pid ${child.pid ?? "unknown"})`);
    console.log("Check with: malaclaw flow operator-brief");
    return;
  }
  const { superviseFlow } = await import("../lib/workflow/supervisor.js");
  console.log("Supervising flow (Ctrl-C leaves the flow paused and resumable)...");
  const state = await superviseFlow({
    workflow: resolved.workflow,
    workspaceDir,
    runtime,
    baseRetryMs: opts.retryMinutes * 60_000,
    maxRetryMs: opts.maxRetryMinutes * 60_000,
    maxDurationMs: opts.maxHours * 60 * 60_000,
    onEvent: (event) => {
      if (event.type === "retry_scheduled") {
        console.log(`⏳ blocked; retry #${event.attempt} in ${((event.delayMs ?? 0) / 60_000).toFixed(1)} min`);
      } else if (event.type === "waiting_approval") {
        console.log("⏸ awaiting human approval (malaclaw flow report)");
      } else if (event.type === "run_finished") {
        console.log(`→ flow status: ${event.status}`);
      } else if (event.type === "deadline_reached") {
        console.log("supervision deadline reached; flow left paused");
      }
    },
  });
  printState(state);
  await printUsageSummary(workspaceDir);
  if (state.status === "failed") process.exit(1);
}

export async function runFlowRuntimes(opts: { runtime?: string }): Promise<void> {
  const runtimes = opts.runtime ? [getWorkerRuntime(opts.runtime)] : listWorkerRuntimes();
  console.log("# Worker runtimes\n");
  for (const runtime of runtimes) {
    const health = await runtime.checkAvailable();
    console.log(`- ${runtime.id}: ${health.available ? "available" : "unavailable"}`);
    console.log(`  headless: ${health.supports_headless ? "yes" : "no"}`);
    console.log(`  max_concurrent: ${health.max_concurrent ?? "unknown"}`);
    console.log(`  isolated_workspace: ${health.requires_isolated_workspace ? "required" : "no"}`);
    const caps = Object.entries(runtime.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    console.log(`  capabilities: ${caps.join(", ") || "none"}`);
    if (health.detail) console.log(`  detail: ${health.detail}`);
  }
}

export async function runFlowRuntimeSmoke(opts: {
  runtime: string;
  workspace?: string;
  reportDir?: string;
  model?: string;
  cleanup?: boolean;
}): Promise<void> {
  const result = await runRuntimeSmoke({
    runtime: opts.runtime,
    workspaceDir: opts.workspace,
    reportDir: opts.reportDir,
    model: opts.model,
    keepWorkspace: !opts.cleanup,
  });
  console.log(`Runtime smoke report: ${result.reportPath}`);
  console.log(`Workspace: ${result.workspaceDir}${opts.cleanup && !opts.workspace ? " (removed)" : ""}`);
  console.log(`Flow status: ${result.state?.status ?? "not_run"}`);
  console.log(`Artifact smoke.md: ${result.artifactExists ? "present" : "missing"}`);
  if (!result.health.available) {
    console.log(`Runtime unavailable: ${result.health.detail ?? result.runtime}`);
    process.exit(1);
  }
  if (result.state?.status !== "completed" || !result.artifactExists) process.exit(1);
}

type UsageEvent = {
  type: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; cost_usd?: number };
};

/** Sum usage across ALL usage-carrying events — successes, validation
 *  failures, and worker errors — so retried work is never undercounted. */
export async function summarizeUsage(workspaceDir: string): Promise<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  unitsWithUsage: number;
}> {
  const events = (await readEvents(workspaceDir)) as UsageEvent[];
  const summary = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, unitsWithUsage: 0 };
  // New event logs contain one usage event for every worker attempt, including
  // quota/rate-limit pauses. Keep historical logs readable as a fallback.
  const hasAttemptEvents = events.some((event) => event.type === "unit_attempt_finished");
  const USAGE_EVENTS = hasAttemptEvents
    ? new Set(["unit_attempt_finished"])
    : new Set(["unit_succeeded", "unit_validation_failed", "unit_attempt_failed"]);
  for (const event of events) {
    if (!USAGE_EVENTS.has(event.type) || !event.usage) continue;
    summary.unitsWithUsage += 1;
    summary.inputTokens += event.usage.input_tokens ?? 0;
    summary.outputTokens += event.usage.output_tokens ?? 0;
    summary.totalTokens +=
      event.usage.total_tokens ?? (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
    summary.costUsd += event.usage.cost_usd ?? 0;
  }
  return summary;
}

async function printUsageSummary(workspaceDir: string): Promise<void> {
  const usage = await summarizeUsage(workspaceDir);
  if (usage.unitsWithUsage === 0) return;
  const parts = [`units: ${usage.unitsWithUsage}`, `tokens: ${usage.totalTokens.toLocaleString("en-US")}`];
  if (usage.costUsd > 0) parts.push(`cost: $${usage.costUsd.toFixed(4)}`);
  console.log(`  Σ usage — ${parts.join(", ")}`);
}

function printState(state: {
  status: string;
  units: Record<string, { status: string; attempts: number }>;
  pendingApprovals: Array<{ id: string; stageId: string; stepId?: string; itemId?: string }>;
}): void {
  console.log(`\nFlow status: ${state.status}`);
  for (const [key, unit] of Object.entries(state.units)) {
    const mark = unit.status === "succeeded" ? "✓" : unit.status === "skipped" ? "⊘" : unit.status === "failed" ? "✗" : "·";
    console.log(`  ${mark} ${key} (${unit.status}, attempts: ${unit.attempts})`);
  }
  for (const approval of state.pendingApprovals) {
    const target = [approval.stageId, approval.stepId, approval.itemId].filter(Boolean).join(" / ");
    console.log(`  ⏸ approval required: ${approval.id} (${target}) — malaclaw flow approve ${approval.id}`);
  }
}
