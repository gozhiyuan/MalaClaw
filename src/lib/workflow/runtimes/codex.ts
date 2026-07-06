import path from "node:path";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";
import { classifyCliFailure, collectProducedFiles } from "./classify.js";
import { runSubprocess } from "./subprocess.js";

export type CodexOptions = {
  /** CLI binary (default "codex"). Tests point this at a stub. */
  bin?: string;
  /** Replace the entire argument list (tests / CLI-version drift escape hatch). */
  argsOverride?: string[];
  /** Extra args inserted before the trailing "-" (stdin prompt marker). */
  extraArgs?: string[];
};

/** Headless Codex worker: `codex exec` (non-interactive by design) with a
 *  workspace-write sandbox. The stage contract goes in via stdin. Flags
 *  current as of 2026-07 — adjust via options if the CLI changes. */
export class CodexRuntime implements WorkerRuntime {
  readonly id = "codex";
  private readonly options: CodexOptions;

  constructor(options: CodexOptions = {}) {
    this.options = options;
  }

  private bin(): string {
    return this.options.bin ?? "codex";
  }

  async checkAvailable(): Promise<RuntimeHealth> {
    const probe = await runSubprocess({
      bin: this.bin(),
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      logPath: path.join(process.env.TMPDIR ?? "/tmp", "malaclaw-codex-probe.log"),
    });
    const available = probe.code === 0 && !probe.spawnError;
    return {
      available,
      supports_headless: true,
      max_concurrent: 2,
      requires_isolated_workspace: false,
      detail: available ? probe.output.trim().split("\n")[0] : probe.spawnError ?? "codex CLI not found",
    };
  }

  async runStage(req: StageRunRequest): Promise<StageRunResult> {
    const logPath =
      req.logPath ?? path.join(req.workspaceDir, ".malaclaw", "flow", "logs", `${req.unitKey}.log`);
    const args = this.options.argsOverride ?? [
      "exec",
      "--sandbox", "workspace-write",
      "--skip-git-repo-check",
      "--ephemeral",
      ...(req.model ? ["-m", req.model] : []),
      ...(this.options.extraArgs ?? []),
      "-", // read the prompt from stdin
    ];

    const result = await runSubprocess({
      bin: this.bin(),
      args,
      cwd: req.workspaceDir,
      stdinText: req.instructions,
      timeoutMs: req.timeoutMs,
      logPath,
    });

    if (result.timedOut) {
      return { outcome: "timeout", producedFiles: [], message: "codex timed out", logRef: logPath };
    }
    if (result.spawnError) {
      return { outcome: "worker_error", producedFiles: [], message: result.spawnError, logRef: logPath };
    }
    if (result.code === 0) {
      return {
        outcome: "success",
        producedFiles: await collectProducedFiles(req.workspaceDir, req.outputs),
        logRef: logPath,
      };
    }
    return {
      outcome: classifyCliFailure(result.output),
      producedFiles: [],
      message: result.output.slice(0, 500),
      logRef: logPath,
    };
  }
}
