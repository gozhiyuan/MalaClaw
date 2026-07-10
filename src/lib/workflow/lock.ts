import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { flowDir } from "./state.js";

/** Workspace execution lock shared by the CLI, dashboard, and supervisor:
 *  one flow run per workspace at a time. Lock files carry the holder pid so
 *  stale locks (crashed process) are stolen instead of wedging the
 *  workspace forever. */

export type FlowLock = {
  pid: number;
  holder: string;
  /** Unique ownership token: PID alone is insufficient for re-entrant or
   * stale-lock safety. */
  token: string;
  acquiredAt: string;
};

export class FlowLockHeldError extends Error {
  constructor(readonly lock: FlowLock) {
    super(
      `Workspace is locked by ${lock.holder} (pid ${lock.pid}, since ${lock.acquiredAt}). ` +
      "Another flow run is in progress; wait for it or stop that process.",
    );
    this.name = "FlowLockHeldError";
  }
}

function lockPath(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "lock.json");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is not ours — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readFlowLock(workspaceDir: string): Promise<FlowLock | null> {
  try {
    return JSON.parse(await fs.readFile(lockPath(workspaceDir), "utf-8")) as FlowLock;
  } catch {
    return null;
  }
}

/** Acquire the workspace lock or throw FlowLockHeldError. A lock whose pid
 *  is no longer alive is stale and gets stolen. */
export async function acquireFlowLock(workspaceDir: string, holder: string): Promise<FlowLock> {
  await fs.mkdir(flowDir(workspaceDir), { recursive: true });
  const mine: FlowLock = {
    pid: process.pid,
    holder,
    token: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
  };
  const target = lockPath(workspaceDir);

  for (;;) {
    try {
      // O_EXCL: creation is the atomic acquisition.
      await fs.writeFile(target, JSON.stringify(mine, null, 2), { flag: "wx" });
      return mine;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    const existing = await readFlowLock(workspaceDir);
    // Do not let the same process silently re-enter: it would overwrite the
    // ownership record and make the first caller capable of releasing a later
    // caller's lock.
    if (existing && pidAlive(existing.pid)) throw new FlowLockHeldError(existing);

    // Atomically move the stale entry out of the way. A competing reclaimer
    // may win the following O_EXCL create; loop and observe its live lock.
    const stale = `${target}.stale-${process.pid}-${crypto.randomUUID()}`;
    try {
      await fs.rename(target, stale);
      await fs.rm(stale, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

/** Release only if we still hold it — a stolen lock is not ours to remove. */
export async function releaseFlowLock(workspaceDir: string, lock: FlowLock): Promise<void> {
  const existing = await readFlowLock(workspaceDir);
  if (existing && existing.pid === process.pid && existing.token === lock.token) {
    await fs.rm(lockPath(workspaceDir), { force: true });
  }
}
