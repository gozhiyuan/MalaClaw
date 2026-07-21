import { readEvents, loadFlowState } from "./state.js";
import { readSupervisorRecord } from "./supervisor.js";

/** A compact, provider-neutral handoff for an operator agent or a person.
 * It deliberately contains no approval or mutation command: monitoring loops
 * may observe and report, but human gates remain explicit MalaClaw actions. */
export async function renderOperatorBrief(workspaceDir: string): Promise<string> {
  const [state, events, supervisor] = await Promise.all([
    loadFlowState(workspaceDir),
    readEvents(workspaceDir),
    readSupervisorRecord(workspaceDir),
  ]);
  if (!state) return "# MalaClaw Operator Brief\n\nNo flow state exists. Start with `malaclaw flow run`.\n";

  const failed = Object.entries(state.units).filter(([, unit]) => unit.status === "failed").map(([key]) => key);
  const pending = Object.entries(state.units).filter(([, unit]) => unit.status === "pending").map(([key]) => key);
  const latest = events.at(-1);
  const lines = [
    "# MalaClaw Operator Brief",
    "",
    `Status: **${state.status}**`,
    `Updated: ${state.updatedAt}`,
    `Completed units: ${Object.values(state.units).filter((unit) => unit.status === "succeeded").length}/${Object.keys(state.units).length}`,
    `Recorded tokens: ${state.telemetry.recordedTokens.toLocaleString("en-US")}`,
  ];
  if (failed.length > 0) lines.push(`Failed units: ${failed.join(", ")}`);
  if (pending.length > 0) lines.push(`Pending units: ${pending.join(", ")}`);
  if (state.pendingApprovals.length > 0) {
    lines.push(`Pending approvals: ${state.pendingApprovals.map((approval) => approval.id).join(", ")}`);
  }
  if (latest) lines.push(`Latest event: ${latest.type}${latest.key ? ` (${latest.key})` : ""}`);
  if (supervisor) {
    lines.push(`Supervisor: retries ${supervisor.retries}; ${supervisor.blockerReason ?? "no current blocker"}`);
    if (supervisor.nextRetryAt) lines.push(`Next supervisor retry: ${supervisor.nextRetryAt}`);
  }
  lines.push("", "## Recommended Action");
  if (state.pendingApprovals.length > 0) {
    lines.push("Inspect the listed artifacts and ask the human to approve explicitly with `malaclaw flow approve <id>` or `malaclaw flow review --batch`.");
  } else if (state.status === "paused_blocker") {
    lines.push("Keep `malaclaw flow supervise` running for transient quota/runtime blockers; do not reset completed work.");
  } else if (state.status === "paused_by_operator") {
    lines.push("The operator requested a safe pause. Inspect current artifacts, then run `malaclaw flow resume` when ready.");
  } else if (state.status === "cancelled") {
    lines.push("The operator cancelled an in-flight unit. Inspect its log/checkpoint, then run `malaclaw flow resume` to retry that pending unit.");
  } else if (state.status === "failed") {
    lines.push("Inspect the stage logs and reports, then use `malaclaw flow retry` after fixing an external or deterministic failure.");
  } else if (state.status === "idle") {
    lines.push("Continue with `malaclaw flow continue` after confirming the selected runtime.");
  } else {
    lines.push("Observe progress. Do not mutate the workflow from an operator loop.");
  }
  return `${lines.join("\n")}\n`;
}
