import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "../safe-paths.js";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime, RuntimeCapabilities } from "./base.js";
import { SINGLE_OUTPUT_API_CAPABILITIES } from "./base.js";
import { classifyCliFailure, collectProducedFiles } from "./classify.js";
import { runSubprocess } from "./subprocess.js";

/** Provider hooks for the declared-command tool round. Mirrors the
 *  openai-compatible semantics: the model may call the stage-declared
 *  command once, gets stdout/stderr back, then must return the artifact. */
export type ChatApiToolHooks = {
  /** Request body carrying prior turns plus the declared-command tool. */
  bodyWithTool: (model: string, system: string, turns: unknown[]) => unknown;
  /** First user turn from the rendered stage prompt. */
  userTurn: (content: string) => unknown;
  /** Tool invocations in a parsed 2xx response (empty ⇒ final answer). */
  parseToolCalls: (response: unknown) => Array<{ id: string }>;
  /** The assistant turn to replay back verbatim in the continuation. */
  assistantTurn: (response: unknown) => unknown;
  /** Turn delivering the command results to the model. */
  toolResultTurn: (results: Array<{ id: string; content: string }>) => unknown;
};

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
  /** Present ⇒ the runtime advertises and runs the declared-command tool. */
  tools?: ChatApiToolHooks;
};

const SYSTEM_PROMPT =
  "You are a headless writing worker. Return only the artifact content for the requested output file.";
const SYSTEM_PROMPT_WITH_TOOL =
  "You are a headless writing worker. You may call run_declared_stage_command once for the stage-declared tool, then return only the artifact content for the requested output file.";

function isConcrete(outputPath: string): boolean {
  return !outputPath.includes("*") && !outputPath.includes("{{");
}

export class ChatApiRuntime implements WorkerRuntime {
  readonly id: string;
  readonly capabilities: RuntimeCapabilities;

  constructor(private readonly provider: ChatApiProvider, private readonly model?: string) {
    this.id = provider.id;
    this.capabilities = {
      ...SINGLE_OUTPUT_API_CAPABILITIES,
      declared_command_tool: provider.tools !== undefined,
      provider_tool_calling: provider.tools !== undefined,
    };
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
    const headers = { "content-type": "application/json", ...this.provider.headers(apiKey) };
    const logChunks: string[] = [];
    const post = async (body: unknown): Promise<{ ok: boolean; status: number; text: string }> => {
      const response = await fetch(this.provider.endpoint(model), {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      const text = await response.text();
      logChunks.push(`# response ${logChunks.filter((c) => c.startsWith("# response")).length + 1}\n${text}`);
      return { ok: response.ok, status: response.status, text };
    };
    const flushLog = async () => {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.writeFile(logPath, logChunks.join("\n\n"), "utf-8");
    };

    try {
      const hooks = this.provider.tools;
      const useTool = Boolean(hooks && req.command);
      const turns: unknown[] = useTool ? [hooks!.userTurn(req.instructions)] : [];

      let result = await post(useTool
        ? hooks!.bodyWithTool(model, SYSTEM_PROMPT_WITH_TOOL, turns)
        : this.provider.body(model, SYSTEM_PROMPT, req.instructions));

      if (!result.ok) {
        await flushLog();
        return {
          outcome: result.status === 429 ? "rate_limited" : classifyCliFailure(result.text),
          producedFiles: [],
          message: result.text.slice(0, 500),
          logRef: logPath,
        };
      }

      let raw: unknown;
      try {
        raw = JSON.parse(result.text);
      } catch {
        await flushLog();
        return { outcome: "worker_error", producedFiles: [], message: "response was not parseable", logRef: logPath };
      }

      let usage = this.provider.parse(raw);
      const toolCalls = useTool ? hooks!.parseToolCalls(raw) : [];
      if (useTool && toolCalls.length > 0 && req.command) {
        // Single tool round, mirroring the openai-compatible semantics.
        turns.push(hooks!.assistantTurn(raw));
        const results: Array<{ id: string; content: string }> = [];
        for (const call of toolCalls) {
          const toolResult = await runSubprocess({
            bin: req.command.cmd,
            args: req.command.args,
            cwd: req.workspaceDir,
            timeoutMs: Math.max(1_000, Math.min(req.timeoutMs, 120_000)),
            logPath: `${logPath}.tool-${call.id}.log`,
            env: {
              MALACLAW_WORKSPACE: req.workspaceDir,
              MALACLAW_UNIT_KEY: req.unitKey,
              MALACLAW_STAGE_OUTPUTS: JSON.stringify(req.outputs),
              ...(req.promptPath ? { MALACLAW_PROMPT_PATH: req.promptPath } : {}),
              ...(req.model ? { MALACLAW_MODEL: req.model } : {}),
            },
          });
          const content = JSON.stringify({
            code: toolResult.code,
            timedOut: toolResult.timedOut,
            spawnError: toolResult.spawnError,
            output: toolResult.output.slice(-20_000),
          });
          logChunks.push(`# tool ${call.id}\n${content}`);
          results.push({ id: call.id, content });
        }
        turns.push(hooks!.toolResultTurn(results));

        result = await post(hooks!.bodyWithTool(model, SYSTEM_PROMPT_WITH_TOOL, turns));
        if (!result.ok) {
          await flushLog();
          return {
            outcome: result.status === 429 ? "rate_limited" : classifyCliFailure(result.text),
            producedFiles: [],
            message: result.text.slice(0, 500),
            logRef: logPath,
          };
        }
        try {
          raw = JSON.parse(result.text);
        } catch {
          await flushLog();
          return { outcome: "worker_error", producedFiles: [], message: "tool continuation was not parseable", logRef: logPath };
        }
        const finalParsed = this.provider.parse(raw);
        usage = {
          content: finalParsed.content,
          inputTokens: (usage.inputTokens ?? 0) + (finalParsed.inputTokens ?? 0),
          outputTokens: (usage.outputTokens ?? 0) + (finalParsed.outputTokens ?? 0),
        };
      }

      await flushLog();
      if (!usage.content) {
        return { outcome: "worker_error", producedFiles: [], message: "response did not include text content", logRef: logPath };
      }

      const outputPath = resolveWithin(req.workspaceDir, concreteOutputs[0]);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, usage.content, "utf-8");
      return {
        outcome: "success",
        producedFiles: await collectProducedFiles(req.workspaceDir, concreteOutputs),
        logRef: logPath,
        usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
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
  content?: Array<{ type?: string; text?: string; id?: string; name?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const ANTHROPIC_DECLARED_COMMAND_TOOL = {
  name: "run_declared_stage_command",
  description: "Run the command explicitly declared by this workflow stage and return stdout/stderr.",
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why the stage-declared command is needed." },
    },
    additionalProperties: false,
  },
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
    tools: {
      bodyWithTool: (model, system, turns) => ({
        model,
        max_tokens: 8192,
        system,
        messages: turns,
        tools: [ANTHROPIC_DECLARED_COMMAND_TOOL],
      }),
      userTurn: (content) => ({ role: "user", content }),
      parseToolCalls: (raw) =>
        ((raw as AnthropicResponse).content ?? [])
          .filter((block) => block.type === "tool_use" && block.name === ANTHROPIC_DECLARED_COMMAND_TOOL.name)
          .map((block) => ({ id: block.id ?? "declared" })),
      // Replay the assistant content blocks verbatim (Messages API requires
      // the tool_use blocks present in the transcript before tool_result).
      assistantTurn: (raw) => ({ role: "assistant", content: (raw as AnthropicResponse).content ?? [] }),
      toolResultTurn: (results) => ({
        role: "user",
        content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content })),
      }),
    },
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
