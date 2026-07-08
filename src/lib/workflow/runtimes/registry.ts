import type { WorkerRuntime } from "./base.js";
import { ChatApiRuntime, anthropicProvider, geminiProvider } from "./chat-api.js";
import { ClaudeCodeRuntime } from "./claude-code.js";
import { CodexRuntime } from "./codex.js";
import { DryRunRuntime } from "./dry-run.js";
import { OpenAICompatibleRuntime } from "./openai-compatible.js";
import { ScriptRuntime } from "./script.js";

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

export function listWorkerRuntimes(): WorkerRuntime[] {
  return [...runtimes.values()];
}

registerWorkerRuntime(new DryRunRuntime());
registerWorkerRuntime(new ScriptRuntime());
registerWorkerRuntime(new ClaudeCodeRuntime());
registerWorkerRuntime(new CodexRuntime());
registerWorkerRuntime(new OpenAICompatibleRuntime());
registerWorkerRuntime(new OpenAICompatibleRuntime({ id: "openai-api" }));
registerWorkerRuntime(new ChatApiRuntime(anthropicProvider()));
registerWorkerRuntime(new ChatApiRuntime(geminiProvider()));
// Ollama is the OpenAI-compatible runtime pointed at the local server.
registerWorkerRuntime(new OpenAICompatibleRuntime({
  id: "ollama",
  baseUrl: process.env.MALACLAW_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
  model: process.env.MALACLAW_OLLAMA_MODEL ?? "llama3.1:8b",
}));
