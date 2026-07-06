import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "../safe-paths.js";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";
import { classifyCliFailure, collectProducedFiles } from "./classify.js";

export type OpenAICompatibleOptions = {
  id?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
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
      const response = await fetch(`${this.baseUrl()}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model(req),
          messages: [
            {
              role: "system",
              content: "You are a headless writing worker. Return only the artifact content for the requested output file.",
            },
            { role: "user", content: req.instructions },
          ],
        }),
      });
      const text = await response.text();
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.writeFile(logPath, text, "utf-8");

      if (!response.ok) {
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
        return { outcome: "worker_error", producedFiles: [], message: "response was not JSON", logRef: logPath };
      }
      const content = parsed.choices?.[0]?.message?.content;
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
        usage: {
          input_tokens: parsed.usage?.prompt_tokens,
          output_tokens: parsed.usage?.completion_tokens,
        },
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
