import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "../safe-paths.js";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";
import { classifyCliFailure, collectProducedFiles } from "./classify.js";

/** Provider descriptor for single-output hosted chat APIs (Anthropic, Gemini).
 *  Same contract as OpenAICompatibleRuntime: one model response into one
 *  concrete output file — not a coding harness. */
export type ChatApiProvider = {
  id: string;
  /** Resolve API key from options/env; missing key ⇒ unavailable. */
  apiKey: () => string | undefined;
  keyHint: string;
  endpoint: (model: string) => string;
  headers: (apiKey: string) => Record<string, string>;
  body: (model: string, system: string, user: string) => unknown;
  /** Extract text + token usage from a parsed 2xx response. */
  parse: (response: unknown) => {
    content?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
  defaultModel: string;
};

const SYSTEM_PROMPT =
  "You are a headless writing worker. Return only the artifact content for the requested output file.";

function isConcrete(outputPath: string): boolean {
  return !outputPath.includes("*") && !outputPath.includes("{{");
}

export class ChatApiRuntime implements WorkerRuntime {
  readonly id: string;

  constructor(private readonly provider: ChatApiProvider, private readonly model?: string) {
    this.id = provider.id;
  }

  private resolveModel(req?: StageRunRequest): string {
    return req?.model ?? this.model ?? this.provider.defaultModel;
  }

  async checkAvailable(): Promise<RuntimeHealth> {
    const hasKey = Boolean(this.provider.apiKey());
    return {
      available: hasKey,
      supports_headless: true,
      max_concurrent: 2,
      requires_isolated_workspace: false,
      detail: hasKey
        ? `${this.id} -> ${this.provider.endpoint(this.resolveModel())}`
        : `${this.id} requires ${this.provider.keyHint}`,
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
    const apiKey = this.provider.apiKey();
    if (!apiKey) {
      return { outcome: "permission_blocked", producedFiles: [], message: `${this.id} requires ${this.provider.keyHint}` };
    }

    const model = this.resolveModel(req);
    const logPath = req.logPath ?? path.join(req.workspaceDir, ".malaclaw", "flow", "logs", `${req.unitKey}.log`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const response = await fetch(this.provider.endpoint(model), {
        method: "POST",
        headers: { "content-type": "application/json", ...this.provider.headers(apiKey) },
        signal: controller.signal,
        body: JSON.stringify(this.provider.body(model, SYSTEM_PROMPT, req.instructions)),
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

      let parsed: ReturnType<ChatApiProvider["parse"]>;
      try {
        parsed = this.provider.parse(JSON.parse(text));
      } catch {
        return { outcome: "worker_error", producedFiles: [], message: "response was not parseable", logRef: logPath };
      }
      if (!parsed.content) {
        return { outcome: "worker_error", producedFiles: [], message: "response did not include text content", logRef: logPath };
      }

      const outputPath = resolveWithin(req.workspaceDir, concreteOutputs[0]);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, parsed.content, "utf-8");
      return {
        outcome: "success",
        producedFiles: await collectProducedFiles(req.workspaceDir, concreteOutputs),
        logRef: logPath,
        usage: { input_tokens: parsed.inputTokens, output_tokens: parsed.outputTokens },
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

// ── Providers ────────────────────────────────────────────────────────────────

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function anthropicProvider(overrides: { baseUrl?: string } = {}): ChatApiProvider {
  const baseUrl = () =>
    (overrides.baseUrl ?? process.env.MALACLAW_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");
  return {
    id: "anthropic-api",
    apiKey: () => process.env.MALACLAW_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
    keyHint: "MALACLAW_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY",
    endpoint: () => `${baseUrl()}/v1/messages`,
    headers: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
    body: (model, system, user) => ({
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
    parse: (raw) => {
      const response = raw as AnthropicResponse;
      const content = response.content
        ?.filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      return {
        content: content || undefined,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };
    },
    defaultModel: process.env.MALACLAW_ANTHROPIC_MODEL ?? "claude-sonnet-5",
  };
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export function geminiProvider(overrides: { baseUrl?: string } = {}): ChatApiProvider {
  const baseUrl = () =>
    (overrides.baseUrl ?? process.env.MALACLAW_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  return {
    id: "gemini-api",
    apiKey: () => process.env.MALACLAW_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    keyHint: "MALACLAW_GEMINI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY",
    endpoint: (model) => `${baseUrl()}/v1beta/models/${model}:generateContent`,
    headers: (apiKey) => ({ "x-goog-api-key": apiKey }),
    body: (_model, system, user) => ({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
    }),
    parse: (raw) => {
      const response = raw as GeminiResponse;
      const content = response.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("");
      return {
        content: content || undefined,
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      };
    },
    defaultModel: process.env.MALACLAW_GEMINI_MODEL ?? "gemini-2.5-flash",
  };
}
