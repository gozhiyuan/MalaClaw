import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";

export class ScriptRuntime implements WorkerRuntime {
  readonly id = "script";

  async checkAvailable(): Promise<RuntimeHealth> {
    return { available: true, supports_headless: true, max_concurrent: 2 };
  }

  async runStage(req: StageRunRequest): Promise<StageRunResult> {
    if (!req.command) {
      return { outcome: "tool_missing", producedFiles: [], message: "script runtime requires command" };
    }

    const logPath = req.logPath ?? path.join(req.workspaceDir, ".malaclaw", "flow", "logs", `${req.unitKey}.log`);
    await fs.mkdir(path.dirname(logPath), { recursive: true });

    return new Promise((resolve) => {
      const child = spawn(req.command!.cmd, req.command!.args, {
        cwd: req.workspaceDir,
        env: {
          ...process.env,
          MALACLAW_WORKSPACE: req.workspaceDir,
          MALACLAW_UNIT_KEY: req.unitKey,
          MALACLAW_STAGE_OUTPUTS: JSON.stringify(req.outputs),
          ...(req.promptPath ? { MALACLAW_PROMPT_PATH: req.promptPath } : {}),
          ...(req.logPath ? { MALACLAW_LOG_PATH: req.logPath } : {}),
          ...(req.model ? { MALACLAW_MODEL: req.model } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ outcome: "timeout", producedFiles: [], message: "script timed out", logRef: logPath });
      }, req.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", async (err) => {
        clearTimeout(timer);
        await fs.writeFile(logPath, err.message, "utf-8");
        resolve({ outcome: "worker_error", producedFiles: [], message: err.message, logRef: logPath });
      });
      child.on("close", async (code) => {
        clearTimeout(timer);
        await fs.writeFile(logPath, Buffer.concat(chunks), "utf-8");
        if (code === 0) {
          resolve({ outcome: "success", producedFiles: req.outputs, logRef: logPath });
        } else {
          resolve({
            outcome: "worker_error",
            producedFiles: [],
            message: `script exited with code ${code}`,
            logRef: logPath,
          });
        }
      });
    });
  }
}
