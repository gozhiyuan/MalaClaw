import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowDef } from "../schema.js";
import type { WorkerRuntime } from "./runtimes/base.js";
import { runFlow } from "./engine.js";
import { appendEvent, flowDir, type FlowState } from "./state.js";
import { FlowLockHeldError } from "./lock.js";

/** Persistent flow supervision: keep retrying a resumable flow until it
 *  completes, fails, or hits the supervision deadline.
 *
 *  - blockers (quota etc.): delayed retry with exponential backoff
 *  - approvals: never auto-approved — poll and continue once a human acts
 *  - lock collisions (manual CLI/dashboard run in progress): wait politely
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
  type: "run_finished" | "waiting_approval" | "retry_scheduled" | "lock_busy" | "deadline_reached";
  status?: FlowState["status"];
  delayMs?: number;
  attempt?: number;
};

export type SupervisorRecord = {
  pid: number;
  startedAt: string;
  lastStatus?: string;
  blockerReason?: string;
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

async function latestBlockerReason(workspaceDir: string, state: FlowState): Promise<string | undefined> {
  const pendingKeys = Object.entries(state.units)
    .filter(([, unit]) => unit.status === "pending" && unit.lastOutcome)
    .map(([key, unit]) => `${key}: ${unit.lastOutcome}`);
  return pendingKeys[0];
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

  for (;;) {
    if (Date.now() > deadline) {
      opts.onEvent?.({ type: "deadline_reached", status: state?.status });
      await appendEvent(opts.workspaceDir, { type: "supervisor_deadline", status: state?.status });
      break;
    }

    try {
      state = await runFlow({
        workflow: opts.workflow,
        workspaceDir: opts.workspaceDir,
        runtime: opts.runtime,
        lockHolder: "supervisor",
      });
    } catch (err) {
      if (err instanceof FlowLockHeldError) {
        // A manual run is in progress; wait and re-check rather than fight.
        opts.onEvent?.({ type: "lock_busy" });
        await sleep(approvalPollMs);
        continue;
      }
      throw err;
    }

    record.lastStatus = state.status;
    record.history.push({ at: new Date().toISOString(), status: state.status });
    opts.onEvent?.({ type: "run_finished", status: state.status });

    if (state.status === "completed" || state.status === "failed") {
      record.nextRetryAt = undefined;
      record.blockerReason = undefined;
      await writeRecord(opts.workspaceDir, record);
      return state;
    }

    if (state.status === "paused_for_approval") {
      // Humans approve; the supervisor only waits.
      record.blockerReason = `awaiting approval: ${state.pendingApprovals.map((a) => a.id).join(", ")}`;
      record.nextRetryAt = new Date(Date.now() + approvalPollMs).toISOString();
      await writeRecord(opts.workspaceDir, record);
      opts.onEvent?.({ type: "waiting_approval" });
      consecutiveBlocks = 0;
      await sleep(approvalPollMs);
      continue;
    }

    // paused_blocker (quota etc.): exponential backoff, capped.
    consecutiveBlocks += 1;
    record.retries += 1;
    const delayMs = Math.min(baseRetryMs * 2 ** (consecutiveBlocks - 1), maxRetryMs);
    record.blockerReason = await latestBlockerReason(opts.workspaceDir, state);
    record.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    await writeRecord(opts.workspaceDir, record);
    await appendEvent(opts.workspaceDir, {
      type: "supervisor_retry_scheduled",
      delayMs,
      retries: record.retries,
      blocker: record.blockerReason,
    });
    opts.onEvent?.({ type: "retry_scheduled", delayMs, attempt: record.retries });
    await sleep(delayMs);
  }

  await writeRecord(opts.workspaceDir, record);
  return state ?? (await runFlow({ ...opts, lockHolder: "supervisor" }));
}
