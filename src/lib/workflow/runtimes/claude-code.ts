import path from "node:path";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";
import { CLI_HARNESS_CAPABILITIES } from "./base.js";
import { classifyCliFailure, collectProducedFiles } from "./classify.js";
import { runSubprocess } from "./subprocess.js";

export type ClaudeCodeOptions = {
  /** CLI binary (default "claude"). Tests point this at a stub. */
  bin?: string;
  /** Replace the entire argument list (tests / CLI-version drift escape hatch). */
  argsOverride?: string[];
  /** Extra args appended to the defaults. */
  extraArgs?: string[];
  /** Tool allowlist for headless runs; undeclared tools are denied, not prompted.
   *  Bash is deliberately NOT in the defaults: an unattended worker reads
   *  workspace artifacts (including web-fetched research content — a prompt
   *  injection vector), so shell access is opt-in. Stages that need commands
   *  should use the deterministic ScriptRuntime instead. */
  allowedTools?: string[];
};

const DEFAULT_ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];

/** Headless Claude Code worker: `claude -p` with fail-closed permissions.
 *  The rendered stage contract goes in via stdin (arg-length safe); the
 *  structured JSON result provides cost/usage. Flags current as of 2026-07 —
 *  adjust via options if the CLI changes. */
export class ClaudeCodeRuntime implements WorkerRuntime {
  readonly id = "claude-code";
  readonly capabilities = CLI_HARNESS_CAPABILITIES;
  private readonly options: ClaudeCodeOptions;

  constructor(options: ClaudeCodeOptions = {}) {
    this.options = options;
  }

  private bin(): string {
    return this.options.bin ?? "claude";
  }

  async checkAvailable(): Promise<RuntimeHealth> {
    const probe = await runSubprocess({
      bin: this.bin(),
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      logPath: path.join(process.env.TMPDIR ?? "/tmp", "malaclaw-claude-probe.log"),
    });
    const available = probe.code === 0 && !probe.spawnError;
    return {
      available,
      supports_headless: true,
      max_concurrent: 2,
      requires_isolated_workspace: false,
      detail: available ? probe.output.trim().split("\n")[0] : probe.spawnError ?? "claude CLI not found",
    };
  }

  async runStage(req: StageRunRequest): Promise<StageRunResult> {
    const logPath =
      req.logPath ?? path.join(req.workspaceDir, ".malaclaw", "flow", "logs", `${req.unitKey}.log`);
    // Stage grants are additive to the safe defaults (or options override).
    // Bash and other powerful tools stay opt-in per stage, never default.
    const allowed = [...new Set([
      ...(this.options.allowedTools ?? DEFAULT_ALLOWED_TOOLS),
      ...(req.allowedTools ?? []),
    ])].join(",");
    const args = this.options.argsOverride ?? [
      "-p",
      "--output-format", "json",
      "--permission-mode", "acceptEdits",
      "--allowedTools", allowed,
      ...(req.model ? ["--model", req.model] : []),
      ...(this.options.extraArgs ?? []),
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
      return { outcome: "timeout", producedFiles: [], message: "claude-code timed out", logRef: logPath };
    }
    if (result.spawnError) {
      return { outcome: "worker_error", producedFiles: [], message: result.spawnError, logRef: logPath };
    }

    const parsed = parseResultJson(result.output);
    if (result.code === 0 && parsed && parsed.is_error !== true) {
      return {
        outcome: "success",
        producedFiles: await collectProducedFiles(req.workspaceDir, req.outputs),
        logRef: logPath,
        usage: {
          input_tokens: parsed.usage?.input_tokens,
          output_tokens: parsed.usage?.output_tokens,
          cost_usd: parsed.total_cost_usd,
        },
      };
    }
    if (result.code === 0 && !parsed) {
      // Ran fine but produced no parseable result envelope — trust the exit code.
      return {
        outcome: "success",
        producedFiles: await collectProducedFiles(req.workspaceDir, req.outputs),
        logRef: logPath,
      };
    }

    const failureText = parsed?.result ?? result.output;
    return {
      outcome: classifyCliFailure(failureText),
      producedFiles: [],
      message: failureText.slice(0, 500),
      logRef: logPath,
    };
  }
}

type ClaudeResultEnvelope = {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** `claude -p --output-format json` prints one JSON object; find the last
 *  parseable JSON line so stray log lines don't break parsing. */
function parseResultJson(output: string): ClaudeResultEnvelope | null {
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as ClaudeResultEnvelope;
    } catch {
      // keep scanning
    }
  }
  return null;
}
