import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowDef } from "../schema.js";
import type { WorkerRuntime } from "./runtimes/base.js";
import { runFlowUnlocked } from "./engine.js";
import { appendEvent, flowDir, readEvents, type FlowState } from "./state.js";
import { acquireFlowLock, releaseFlowLock } from "./lock.js";

/** Persistent flow supervision: keep retrying a resumable flow until it
 *  completes, fails, or hits the supervision deadline.
 *
 *  - blockers (quota etc.): delayed retry with exponential backoff
 *  - approvals: never auto-approved — poll and continue once a human acts
 *  - one supervisor owns the workspace for its whole lifecycle; manual runs
 *    receive a clear lock error instead of racing wake-ups
 *  - .malaclaw/flow/supervisor.json carries next-retry/blocker/history so
 *    the dashboard can display supervision state
 *
 *  This is a foreground process by design (run it under nohup/tmux/launchd
 *  if you want it detached) — MalaClaw does not install OS schedulers. */

export type SuperviseOptions = {
  workflow: WorkflowDef;
  workspaceDir: string;
  runtime: WorkerRuntime;
  /** Base delay before retrying a blocked flow. Default 5 minutes. */
  baseRetryMs?: number;
  /** Backoff cap. Default 60 minutes. */
  maxRetryMs?: number;
  /** Poll interval while waiting for a human approval. Default 30s. */
  approvalPollMs?: number;
  /** Give up (leaving the flow paused) after this long. Default 7 days. */
  maxDurationMs?: number;
  /** Test seam: sleep implementation. */
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: SupervisorEvent) => void;
};

export type SupervisorEvent = {
  type: "run_finished" | "waiting_approval" | "retry_scheduled" | "deadline_reached" | "stopped_run_limit";
  status?: FlowState["status"];
  delayMs?: number;
  attempt?: number;
};

export type SupervisorRecord = {
  pid: number;
  startedAt: string;
  lastStatus?: string;
  blockerReason?: string;
  blockerKind?: "quota_or_runtime" | "run_limit" | "approval";
  nextRetryAt?: string;
  retries: number;
  history: Array<{ at: string; status: string }>;
};

function supervisorPath(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "supervisor.json");
}

async function writeRecord(workspaceDir: string, record: SupervisorRecord): Promise<void> {
  await fs.mkdir(flowDir(workspaceDir), { recursive: true });
  await fs.writeFile(supervisorPath(workspaceDir), JSON.stringify(record, null, 2), "utf-8");
}

export async function readSupervisorRecord(workspaceDir: string): Promise<SupervisorRecord | null> {
  try {
    return JSON.parse(await fs.readFile(supervisorPath(workspaceDir), "utf-8")) as SupervisorRecord;
  } catch {
    return null;
  }
}

async function latestBlocker(workspaceDir: string, state: FlowState): Promise<{ kind: "quota_or_runtime" | "run_limit"; reason?: string; retryAt?: string }> {
  const events = await readEvents(workspaceDir);
  const latest = [...events].reverse().find((event) => event.type === "run_limit_reached" || event.type === "flow_paused_blocker");
  if (latest?.type === "run_limit_reached") {
    return { kind: "run_limit", reason: typeof latest.reason === "string" ? latest.reason : "run limit reached" };
  }
  const pendingKeys = Object.entries(state.units)
    .filter(([, unit]) => unit.status === "pending" && unit.lastOutcome)
    .map(([key, unit]) => ({ reason: `${key}: ${unit.lastOutcome}`, retryAt: unit.retryAt }));
  return { kind: "quota_or_runtime", reason: pendingKeys[0]?.reason, retryAt: pendingKeys[0]?.retryAt };
}

export async function superviseFlow(opts: SuperviseOptions): Promise<FlowState> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const baseRetryMs = opts.baseRetryMs ?? 5 * 60_000;
  const maxRetryMs = opts.maxRetryMs ?? 60 * 60_000;
  const approvalPollMs = opts.approvalPollMs ?? 30_000;
  const deadline = Date.now() + (opts.maxDurationMs ?? 7 * 24 * 60 * 60_000);

  const record: SupervisorRecord = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    retries: 0,
    history: [],
  };
  let consecutiveBlocks = 0;
  let state: FlowState | undefined;
  let hasRun = false;

  // Hold this lease across waits as well as worker execution. A second
  // supervisor must fail fast rather than periodically waking and competing
  // with the first one. Approval commands intentionally do not need this
  // lease: they only update pending approvals in the saved flow state.
  const lease = await acquireFlowLock(opts.workspaceDir, "supervisor");

  try {
    // Replace a stale record immediately so operator-brief names the current
    // detached PID even while the first worker attempt is still running.
    await writeRecord(opts.workspaceDir, record);
    for (;;) {
      // Always make the initial attempt, even when a very short test or CLI
      // deadline elapsed during setup. Subsequent passes respect the bound.
      if (hasRun && Date.now() > deadline) {
        opts.onEvent?.({ type: "deadline_reached", status: state?.status });
        await appendEvent(opts.workspaceDir, { type: "supervisor_deadline", status: state?.status });
        break;
      }

      hasRun = true;
      state = await runFlowUnlocked({
        workflow: opts.workflow,
        workspaceDir: opts.workspaceDir,
        runtime: opts.runtime,
        lockHolder: "supervisor",
      });

      record.lastStatus = state.status;
      record.history.push({ at: new Date().toISOString(), status: state.status });
      opts.onEvent?.({ type: "run_finished", status: state.status });

      if (state.status === "completed" || state.status === "failed") {
        record.nextRetryAt = undefined;
        record.blockerReason = undefined;
        record.blockerKind = undefined;
        await writeRecord(opts.workspaceDir, record);
        return state;
      }

      if (state.status === "paused_for_approval") {
        // Humans approve; the supervisor only waits.
        record.blockerKind = "approval";
        record.blockerReason = `awaiting approval: ${state.pendingApprovals.map((a) => a.id).join(", ")}`;
        record.nextRetryAt = new Date(Date.now() + approvalPollMs).toISOString();
        await writeRecord(opts.workspaceDir, record);
        opts.onEvent?.({ type: "waiting_approval" });
        consecutiveBlocks = 0;
        await sleep(approvalPollMs);
        continue;
      }

      const blocker = await latestBlocker(opts.workspaceDir, state);
      if (blocker.kind === "run_limit") {
        // Limits are user-configured guardrails, not transient provider
        // errors. Retrying with this supervisor's original workflow would
        // never change the decision, so leave a durable, operator-actionable
        // record and stop. Raising the limit then starting a new supervisor
        // resumes completed work without reset.
        record.blockerKind = "run_limit";
        record.blockerReason = blocker.reason;
        record.nextRetryAt = undefined;
        await writeRecord(opts.workspaceDir, record);
        await appendEvent(opts.workspaceDir, { type: "supervisor_stopped_run_limit", reason: blocker.reason });
        opts.onEvent?.({ type: "stopped_run_limit", status: state.status });
        return state;
      }

      // Prefer a provider-reported reset timestamp. Capped exponential backoff
      // remains the safe fallback for generic quota/runtime failures.
      consecutiveBlocks += 1;
      record.retries += 1;
      const providerDelay = blocker.retryAt ? Date.parse(blocker.retryAt) - Date.now() : Number.NaN;
      const exponentialDelay = Math.min(baseRetryMs * 2 ** (consecutiveBlocks - 1), maxRetryMs);
      const delayMs = Number.isFinite(providerDelay) && providerDelay > 0
        ? Math.min(providerDelay, Math.max(0, deadline - Date.now()))
        : exponentialDelay;
      record.blockerKind = "quota_or_runtime";
      record.blockerReason = blocker.reason;
      record.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
      await writeRecord(opts.workspaceDir, record);
      await appendEvent(opts.workspaceDir, {
        type: "supervisor_retry_scheduled",
        delayMs,
        retries: record.retries,
        blocker: record.blockerReason,
        retry_at: blocker.retryAt,
      });
      opts.onEvent?.({ type: "retry_scheduled", delayMs, attempt: record.retries });
      await sleep(delayMs);
    }

    await writeRecord(opts.workspaceDir, record);
    // The initial run always produces a state unless the workflow is invalid;
    // do not start new work after the supervisor deadline.
    if (!state) throw new Error("Supervisor reached its deadline before the flow initialized");
    return state;
  } finally {
    await releaseFlowLock(opts.workspaceDir, lease);
  }
}
