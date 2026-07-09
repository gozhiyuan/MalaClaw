import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { OpenAICompatibleRuntime } from "../src/lib/workflow/runtimes/openai-compatible.js";
import { getWorkerRuntime } from "../src/lib/workflow/runtimes/registry.js";

const tempDirs: string[] = [];
const servers: http.Server[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-openai-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function request(workspaceDir: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceDir,
    unitKey: "draft",
    owner: "writer",
    instructions: "Write draft.md",
    outputs: ["draft.md"],
    timeoutMs: 5_000,
    ...overrides,
  };
}

async function serve(handler: (req: http.IncomingMessage, body: string) => { status?: number; body: unknown }): Promise<string> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const result = handler(req, body);
      res.statusCode = result.status ?? 200;
      res.setHeader("content-type", "application/json");
      res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to a port");
  return `http://127.0.0.1:${address.port}/v1`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe("OpenAICompatibleRuntime", () => {
  it("writes one chat-completion response into the declared output", async () => {
    const ws = await makeWorkspace();
    let posted: Record<string, unknown> | undefined;
    const baseUrl = await serve((_req, body) => {
      posted = JSON.parse(body) as Record<string, unknown>;
      return {
        body: {
          choices: [{ message: { content: "# Draft\n\nAPI generated text." } }],
          usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
        },
      };
    });
    const rt = new OpenAICompatibleRuntime({ baseUrl, model: "local-test-model" });

    const result = await rt.runStage(request(ws));
    expect(result.outcome).toBe("success");
    expect(result.producedFiles).toEqual(["draft.md"]);
    expect(result.usage?.input_tokens).toBe(10);
    expect(result.usage?.output_tokens).toBe(7);
    expect(await fs.readFile(path.join(ws, "draft.md"), "utf-8")).toContain("API generated text");
    expect(posted?.model).toBe("local-test-model");
    expect(posted?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "Write draft.md" }),
    ]));
  });

  it("fails closed for multi-output work that requires a harness", async () => {
    const ws = await makeWorkspace();
    const rt = new OpenAICompatibleRuntime({ baseUrl: "http://127.0.0.1:1/v1" });
    const result = await rt.runStage(request(ws, { outputs: ["a.md", "b.md"] }));
    expect(result.outcome).toBe("tool_missing");
    expect(result.message).toContain("exactly one concrete output");
  });

  it("classifies rate limits from HTTP responses", async () => {
    const ws = await makeWorkspace();
    const baseUrl = await serve(() => ({ status: 429, body: { error: { message: "rate limit" } } }));
    const rt = new OpenAICompatibleRuntime({ baseUrl });
    const result = await rt.runStage(request(ws));
    expect(result.outcome).toBe("rate_limited");
  });

  it("lets the model call the stage-declared command before writing the output", async () => {
    const ws = await makeWorkspace();
    const toolScript = path.join(ws, "tool.js");
    await fs.writeFile(toolScript, "console.log('tool data from declared command')", "utf-8");
    const requests: Array<Record<string, unknown>> = [];
    const baseUrl = await serve((_req, body) => {
      const posted = JSON.parse(body) as Record<string, unknown>;
      requests.push(posted);
      if (requests.length === 1) {
        return {
          body: {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call-1",
                  type: "function",
                  function: { name: "run_declared_stage_command", arguments: "{\"reason\":\"need data\"}" },
                }],
              },
            }],
            usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
          },
        };
      }
      return {
        body: {
          choices: [{ message: { content: "# Draft\n\nUsed tool data." } }],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        },
      };
    });
    const rt = new OpenAICompatibleRuntime({ baseUrl, model: "tool-test-model" });
    const result = await rt.runStage(request(ws, {
      command: { cmd: process.execPath, args: [toolScript] },
    }));
    expect(result.outcome).toBe("success");
    expect(result.usage).toEqual({ input_tokens: 31, output_tokens: 8, total_tokens: 39 });
    expect(requests[0].tools).toBeDefined();
    const secondMessages = requests[1].messages as Array<{ role: string; content?: string }>;
    expect(secondMessages.some((message) => message.role === "tool" && message.content?.includes("tool data"))).toBe(true);
    expect(await fs.readFile(path.join(ws, "draft.md"), "utf-8")).toContain("Used tool data");
  });

  it("reports local servers as available without an API key", async () => {
    const rt = new OpenAICompatibleRuntime({ baseUrl: "http://127.0.0.1:11434/v1" });
    const health = await rt.checkAvailable();
    expect(health.available).toBe(true);
  });

  it("registers openai-compatible and openai-api ids", () => {
    expect(getWorkerRuntime("openai-compatible").id).toBe("openai-compatible");
    expect(getWorkerRuntime("openai-api").id).toBe("openai-api");
  });
});
