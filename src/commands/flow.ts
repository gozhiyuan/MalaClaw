import { loadManifest } from "../lib/loader.js";
import { resolveManifest } from "../lib/resolver.js";
import { runFlow, approveFlow, approveAllFlow, getFlowStatus } from "../lib/workflow/engine.js";
import { getWorkerRuntime, listWorkerRuntimes } from "../lib/workflow/runtimes/registry.js";
import { runRuntimeSmoke } from "../lib/workflow/runtime-smoke.js";

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
  if (state.status === "failed") process.exit(1);
}

export async function runFlowStatus(): Promise<void> {
  const state = await getFlowStatus(process.cwd());
  if (!state) {
    console.log("No flow state. Run: malaclaw flow run");
    return;
  }
  printState(state);
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

export async function runFlowRuntimes(opts: { runtime?: string }): Promise<void> {
  const runtimes = opts.runtime ? [getWorkerRuntime(opts.runtime)] : listWorkerRuntimes();
  console.log("# Worker runtimes\n");
  for (const runtime of runtimes) {
    const health = await runtime.checkAvailable();
    console.log(`- ${runtime.id}: ${health.available ? "available" : "unavailable"}`);
    console.log(`  headless: ${health.supports_headless ? "yes" : "no"}`);
    console.log(`  max_concurrent: ${health.max_concurrent ?? "unknown"}`);
    console.log(`  isolated_workspace: ${health.requires_isolated_workspace ? "required" : "no"}`);
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

function printState(state: {
  status: string;
  units: Record<string, { status: string; attempts: number }>;
  pendingApprovals: Array<{ id: string; stageId: string; stepId?: string; itemId?: string }>;
}): void {
  console.log(`\nFlow status: ${state.status}`);
  for (const [key, unit] of Object.entries(state.units)) {
    const mark = unit.status === "succeeded" ? "✓" : unit.status === "failed" ? "✗" : "·";
    console.log(`  ${mark} ${key} (${unit.status}, attempts: ${unit.attempts})`);
  }
  for (const approval of state.pendingApprovals) {
    const target = [approval.stageId, approval.stepId, approval.itemId].filter(Boolean).join(" / ");
    console.log(`  ⏸ approval required: ${approval.id} (${target}) — malaclaw flow approve ${approval.id}`);
  }
}
