import type { WorkerRuntime } from "./base.js";
import { DryRunRuntime } from "./dry-run.js";

// Deliberately separate from src/lib/adapters/registry.ts: those are
// install-time provisioners; these execute workflow units.
const runtimes = new Map<string, WorkerRuntime>();

export function registerWorkerRuntime(runtime: WorkerRuntime): void {
  runtimes.set(runtime.id, runtime);
}

export function getWorkerRuntime(id: string): WorkerRuntime {
  const runtime = runtimes.get(id);
  if (!runtime) {
    throw new Error(
      `Unknown worker runtime "${id}". Registered: ${[...runtimes.keys()].join(", ")}`,
    );
  }
  return runtime;
}

registerWorkerRuntime(new DryRunRuntime());
