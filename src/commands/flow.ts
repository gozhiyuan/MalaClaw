import { loadManifest } from "../lib/loader.js";
import { resolveManifest } from "../lib/resolver.js";
import { runFlow, approveFlow, approveAllFlow, getFlowStatus } from "../lib/workflow/engine.js";
import { getWorkerRuntime } from "../lib/workflow/runtimes/registry.js";

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
