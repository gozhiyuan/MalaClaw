import fs from "node:fs/promises";
import path from "node:path";
import { flowDir } from "./state.js";

/** Workspace execution lock shared by the CLI, dashboard, and supervisor:
 *  one flow run per workspace at a time. Lock files carry the holder pid so
 *  stale locks (crashed process) are stolen instead of wedging the
 *  workspace forever. */

export type FlowLock = {
  pid: number;
  holder: string;
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
  const mine: FlowLock = { pid: process.pid, holder, acquiredAt: new Date().toISOString() };
  try {
    // O_EXCL: creation is the atomic acquisition.
    await fs.writeFile(lockPath(workspaceDir), JSON.stringify(mine, null, 2), { flag: "wx" });
    return mine;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const existing = await readFlowLock(workspaceDir);
  if (existing && existing.pid !== process.pid && pidAlive(existing.pid)) {
    throw new FlowLockHeldError(existing);
  }
  // Stale (dead pid, unreadable, or our own): replace.
  await fs.writeFile(lockPath(workspaceDir), JSON.stringify(mine, null, 2), "utf-8");
  return mine;
}

/** Release only if we still hold it — a stolen lock is not ours to remove. */
export async function releaseFlowLock(workspaceDir: string): Promise<void> {
  const existing = await readFlowLock(workspaceDir);
  if (existing && existing.pid === process.pid) {
    await fs.rm(lockPath(workspaceDir), { force: true });
  }
}
