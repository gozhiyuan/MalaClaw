import path from "node:path";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";
import { DETERMINISTIC_CAPABILITIES } from "./base.js";
import { runSubprocess } from "./subprocess.js";

type AdapterResponse = {
  version: 1;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  job_id: string;
  adapter?: string;
  retry_after_seconds?: number;
  message?: string;
};

function parseAdapterResponse(output: string): AdapterResponse | null {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const parsed = JSON.parse(line) as AdapterResponse;
      if (parsed?.version === 1 && typeof parsed.job_id === "string" && ["queued", "running", "succeeded", "failed", "cancelled"].includes(parsed.status)) return parsed;
    } catch { /* adapter logs may precede its machine-readable response */ }
  }
  return null;
}

/** A generic external-job bridge. A workspace-owned adapter receives one JSON
 * request (`submit`, `status`, `collect`, or `cancel`) and returns one JSON
 * response line. The engine owns the persisted handle; provider credentials
 * never enter state, telemetry, or publication artifacts. */
export class RemoteJobRuntime implements WorkerRuntime {
  readonly id = "remote-job";
  readonly capabilities = DETERMINISTIC_CAPABILITIES;

  async checkAvailable(): Promise<RuntimeHealth> { return { available: true, supports_headless: true, max_concurrent: 4 }; }

  private async invoke(req: StageRunRequest, operation: "submit" | "status" | "collect" | "cancel", logPath: string, abortSignal?: AbortSignal) {
    if (!req.command) throw new Error("remote-job runtime requires an adapter command");
    return runSubprocess({
      bin: req.command.cmd, args: req.command.args, cwd: req.workspaceDir, timeoutMs: req.timeoutMs, logPath, abortSignal,
      stdinText: JSON.stringify({ version: 1, operation, workspace: req.workspaceDir, unit_key: req.unitKey, outputs: req.outputs, job: req.remoteJob ?? null }),
      env: { MALACLAW_REMOTE_OPERATION: operation },
    });
  }

  private handle(req: StageRunRequest, response: AdapterResponse): { remoteJob: NonNullable<StageRunResult["remoteJob"]> } {
    return { remoteJob: { adapter: response.adapter ?? req.command!.cmd, jobId: response.job_id, status: response.status, submittedAt: req.remoteJob?.submittedAt ?? new Date().toISOString(), command: req.command } };
  }

  async runStage(req: StageRunRequest): Promise<StageRunResult> {
    if (!req.command) return { outcome: "tool_missing", producedFiles: [], message: "remote-job runtime requires an adapter command" };
    const logPath = req.logPath ?? path.join(req.workspaceDir, ".malaclaw", "flow", "logs", `${req.unitKey}.log`);
    const operation = req.remoteOperation ?? (req.remoteJob ? "status" : "submit");
    const result = await this.invoke(req, operation, logPath, req.abortSignal);
    if (result.timedOut) return { outcome: "timeout", producedFiles: [], message: `remote adapter ${operation} timed out`, logRef: logPath };
    if (result.aborted) {
      // An aborted local poll must not strand a remote GPU job. Use a fresh
      // signal for best-effort provider cancellation, then preserve the handle.
      if (req.remoteJob) {
        const cancelled = await this.invoke(req, "cancel", logPath).catch(() => null);
        const response = cancelled ? parseAdapterResponse(cancelled.output) : null;
        if (response) return { outcome: "cancelled", producedFiles: [], message: response.message ?? "remote job cancellation requested", logRef: logPath, ...this.handle(req, response) };
      }
      return { outcome: "cancelled", producedFiles: [], message: "remote adapter cancelled", logRef: logPath, remoteJob: req.remoteJob };
    }
    if (result.spawnError) return { outcome: "worker_error", producedFiles: [], message: result.spawnError, logRef: logPath };
    const response = parseAdapterResponse(result.output);
    if (!response) return { outcome: "worker_error", producedFiles: [], message: "remote adapter must emit a version:1 JSON response line", logRef: logPath };
    const handle = this.handle(req, response);
    if (operation === "cancel") {
      return response.status === "cancelled" || response.status === "succeeded"
        ? { outcome: "cancelled", producedFiles: [], message: response.message ?? `remote job ${response.status}`, logRef: logPath, ...handle }
        : { outcome: "worker_error", producedFiles: [], message: response.message ?? `remote job did not cancel (${response.status})`, logRef: logPath, ...handle };
    }
    if (response.status === "queued" || response.status === "running") return { outcome: "remote_pending", producedFiles: [], message: response.message, logRef: logPath, ...handle, retryAfterMs: Math.max(1, response.retry_after_seconds ?? 30) * 1000 };
    if (response.status === "cancelled") return { outcome: "cancelled", producedFiles: [], message: response.message ?? "remote job cancelled", logRef: logPath, ...handle };
    if (response.status === "failed" || result.code !== 0) return { outcome: "worker_error", producedFiles: [], message: response.message ?? `remote job ${response.status}`, logRef: logPath, ...handle };
    if (operation === "collect") return { outcome: "success", producedFiles: req.outputs, message: response.message, logRef: logPath, ...handle };
    // A provider reporting completed only proves compute finished. A separate
    // collect call must materialize declared artifacts before validators run.
    const collected = await this.invoke({ ...req, remoteJob: handle.remoteJob }, "collect", logPath, req.abortSignal);
    if (collected.timedOut || collected.spawnError || collected.aborted) return { outcome: collected.aborted ? "cancelled" : collected.timedOut ? "timeout" : "worker_error", producedFiles: [], message: "remote result collection did not complete", logRef: logPath, ...handle };
    const collection = parseAdapterResponse(collected.output);
    if (!collection || collection.status !== "succeeded" || collected.code !== 0) return { outcome: "worker_error", producedFiles: [], message: collection?.message ?? "remote adapter collect must report succeeded", logRef: logPath, ...handle };
    return { outcome: "success", producedFiles: req.outputs, message: collection.message, logRef: logPath, ...this.handle(req, collection) };
  }
}
