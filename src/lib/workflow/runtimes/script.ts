import path from "node:path";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";
import { DETERMINISTIC_CAPABILITIES } from "./base.js";
import { runSubprocess } from "./subprocess.js";

/** Deterministic-script worker: runs the stage's structured command
 *  (no shell interpolation) with the stage contract exposed via env vars.
 *  Use this for reproducible local tools, data preparation, and build steps. */
export class ScriptRuntime implements WorkerRuntime {
  readonly id = "script";
  readonly capabilities = DETERMINISTIC_CAPABILITIES;

  async checkAvailable(): Promise<RuntimeHealth> {
    return { available: true, supports_headless: true, max_concurrent: 2 };
  }

  async runStage(req: StageRunRequest): Promise<StageRunResult> {
    if (!req.command) {
      return { outcome: "tool_missing", producedFiles: [], message: "script runtime requires command" };
    }

    const logPath = req.logPath ?? path.join(req.workspaceDir, ".malaclaw", "flow", "logs", `${req.unitKey}.log`);
    const result = await runSubprocess({
      bin: req.command.cmd,
      args: req.command.args,
      cwd: req.workspaceDir,
      timeoutMs: req.timeoutMs,
      logPath,
      env: {
        MALACLAW_WORKSPACE: req.workspaceDir,
        MALACLAW_UNIT_KEY: req.unitKey,
        MALACLAW_STAGE_OUTPUTS: JSON.stringify(req.outputs),
        ...(req.promptPath ? { MALACLAW_PROMPT_PATH: req.promptPath } : {}),
        ...(req.logPath ? { MALACLAW_LOG_PATH: req.logPath } : {}),
        ...(req.model ? { MALACLAW_MODEL: req.model } : {}),
      },
    });

    if (result.timedOut) {
      return { outcome: "timeout", producedFiles: [], message: "script timed out", logRef: logPath };
    }
    if (result.spawnError) {
      return { outcome: "worker_error", producedFiles: [], message: result.spawnError, logRef: logPath };
    }
    if (result.code === 0) {
      return { outcome: "success", producedFiles: req.outputs, logRef: logPath };
    }
    return {
      outcome: "worker_error",
      producedFiles: [],
      message: `script exited with code ${result.code}`,
      logRef: logPath,
    };
  }
}
