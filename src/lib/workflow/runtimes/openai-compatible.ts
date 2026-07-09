import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "../safe-paths.js";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";
import { classifyCliFailure, collectProducedFiles } from "./classify.js";
import { runSubprocess } from "./subprocess.js";

export type OpenAICompatibleOptions = {
  id?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: NonNullable<NonNullable<ChatCompletionResponse["choices"]>[number]["message"]>["tool_calls"];
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function defaultBaseUrl(): string {
  return process.env.MALACLAW_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
}

function defaultApiKey(): string | undefined {
  return process.env.MALACLAW_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
}

function defaultModel(): string {
  return process.env.MALACLAW_OPENAI_MODEL ?? "gpt-4.1-mini";
}

function isConcrete(outputPath: string): boolean {
  return !outputPath.includes("*") && !outputPath.includes("{{");
}

function addUsage(
  current: { input_tokens?: number; output_tokens?: number; total_tokens?: number },
  usage: ChatCompletionResponse["usage"],
): { input_tokens?: number; output_tokens?: number; total_tokens?: number } {
  return {
    input_tokens: (current.input_tokens ?? 0) + (usage?.prompt_tokens ?? 0) || undefined,
    output_tokens: (current.output_tokens ?? 0) + (usage?.completion_tokens ?? 0) || undefined,
    total_tokens: (current.total_tokens ?? 0) + (usage?.total_tokens ?? 0) || undefined,
  };
}

/** Minimal OpenAI-compatible chat runtime for cheap/simple stages.
 *  It is not a coding harness: it writes one model response into one declared
 *  concrete output file. Use codex/claude-code for multi-file edits. */
export class OpenAICompatibleRuntime implements WorkerRuntime {
  readonly id: string;
  private readonly options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.id = options.id ?? "openai-compatible";
    this.options = options;
  }

  private baseUrl(): string {
    return trimTrailingSlash(this.options.baseUrl ?? defaultBaseUrl());
  }

  private apiKey(): string | undefined {
    return this.options.apiKey ?? defaultApiKey();
  }

  private model(req?: StageRunRequest): string {
    return req?.model ?? this.options.model ?? defaultModel();
  }

  async checkAvailable(): Promise<RuntimeHealth> {
    const baseUrl = this.baseUrl();
    const hasKey = Boolean(this.apiKey());
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(baseUrl);
    return {
      available: hasKey || isLocal,
      supports_headless: true,
      max_concurrent: 2,
      requires_isolated_workspace: false,
      detail: hasKey || isLocal
        ? `${this.id} -> ${baseUrl}/chat/completions`
        : `${this.id} requires MALACLAW_OPENAI_API_KEY/OPENAI_API_KEY or a local MALACLAW_OPENAI_BASE_URL`,
    };
  }

  async runStage(req: StageRunRequest): Promise<StageRunResult> {
    const concreteOutputs = req.outputs.filter(isConcrete);
    if (concreteOutputs.length !== 1) {
      return {
        outcome: "tool_missing",
        producedFiles: [],
        message: `${this.id} requires exactly one concrete output; use codex, claude-code, or script for multi-file stages`,
      };
    }

    const logPath = req.logPath ?? path.join(req.workspaceDir, ".malaclaw", "flow", "logs", `${req.unitKey}.log`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const apiKey = this.apiKey();
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: req.command
            ? "You are a headless writing worker. You may call run_declared_stage_command once for the stage-declared tool, then return only the artifact content for the requested output file."
            : "You are a headless writing worker. Return only the artifact content for the requested output file.",
        },
        { role: "user", content: req.instructions },
      ];
      const tools = req.command ? [{
        type: "function",
        function: {
          name: "run_declared_stage_command",
          description: "Run the command explicitly declared by this workflow stage and return stdout/stderr.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string", description: "Why the stage-declared command is needed." },
            },
            additionalProperties: false,
          },
        },
      }] : undefined;

      let response = await fetch(`${this.baseUrl()}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({ model: this.model(req), messages, ...(tools ? { tools, tool_choice: "auto" } : {}) }),
      });
      let text = await response.text();
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      const logChunks = [`# response 1\n${text}`];

      if (!response.ok) {
        await fs.writeFile(logPath, logChunks.join("\n\n"), "utf-8");
        return {
          outcome: response.status === 429 ? "rate_limited" : classifyCliFailure(text),
          producedFiles: [],
          message: text.slice(0, 500),
          logRef: logPath,
        };
      }

      let parsed: ChatCompletionResponse;
      try {
        parsed = JSON.parse(text) as ChatCompletionResponse;
      } catch {
        await fs.writeFile(logPath, logChunks.join("\n\n"), "utf-8");
        return { outcome: "worker_error", producedFiles: [], message: "response was not JSON", logRef: logPath };
      }
      let usage = addUsage({}, parsed.usage);
      let content = parsed.choices?.[0]?.message?.content ?? undefined;
      const toolCalls = parsed.choices?.[0]?.message?.tool_calls ?? [];
      if (req.command && toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: parsed.choices?.[0]?.message?.content ?? null,
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          if (call.function?.name !== "run_declared_stage_command") continue;
          const toolLogPath = `${logPath}.tool-${call.id ?? "declared"}.log`;
          const toolResult = await runSubprocess({
            bin: req.command.cmd,
            args: req.command.args,
            cwd: req.workspaceDir,
            timeoutMs: Math.max(1_000, Math.min(req.timeoutMs, 120_000)),
            logPath: toolLogPath,
            env: {
              MALACLAW_WORKSPACE: req.workspaceDir,
              MALACLAW_UNIT_KEY: req.unitKey,
              MALACLAW_STAGE_OUTPUTS: JSON.stringify(req.outputs),
              ...(req.promptPath ? { MALACLAW_PROMPT_PATH: req.promptPath } : {}),
              ...(req.model ? { MALACLAW_MODEL: req.model } : {}),
            },
          });
          const toolContent = JSON.stringify({
            code: toolResult.code,
            timedOut: toolResult.timedOut,
            spawnError: toolResult.spawnError,
            output: toolResult.output.slice(-20_000),
          });
          logChunks.push(`# tool ${call.id ?? "declared"}\n${toolContent}`);
          messages.push({
            role: "tool",
            tool_call_id: call.id ?? "declared",
            content: toolContent,
          });
        }
        response = await fetch(`${this.baseUrl()}/chat/completions`, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({ model: this.model(req), messages }),
        });
        text = await response.text();
        logChunks.push(`# response 2\n${text}`);
        if (!response.ok) {
          await fs.writeFile(logPath, logChunks.join("\n\n"), "utf-8");
          return {
            outcome: response.status === 429 ? "rate_limited" : classifyCliFailure(text),
            producedFiles: [],
            message: text.slice(0, 500),
            logRef: logPath,
          };
        }
        try {
          parsed = JSON.parse(text) as ChatCompletionResponse;
        } catch {
          await fs.writeFile(logPath, logChunks.join("\n\n"), "utf-8");
          return { outcome: "worker_error", producedFiles: [], message: "tool follow-up response was not JSON", logRef: logPath };
        }
        usage = addUsage(usage, parsed.usage);
        content = parsed.choices?.[0]?.message?.content ?? undefined;
      }
      await fs.writeFile(logPath, logChunks.join("\n\n"), "utf-8");
      if (!content) {
        return { outcome: "worker_error", producedFiles: [], message: "response did not include message content", logRef: logPath };
      }

      const outputPath = resolveWithin(req.workspaceDir, concreteOutputs[0]);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, content, "utf-8");
      return {
        outcome: "success",
        producedFiles: await collectProducedFiles(req.workspaceDir, concreteOutputs),
        logRef: logPath,
        usage,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { outcome: "timeout", producedFiles: [], message: `${this.id} timed out`, logRef: logPath };
      }
      return {
        outcome: "worker_error",
        producedFiles: [],
        message: err instanceof Error ? err.message : String(err),
        logRef: logPath,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
