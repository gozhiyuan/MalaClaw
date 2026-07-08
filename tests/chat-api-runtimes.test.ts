import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatApiRuntime, anthropicProvider, geminiProvider } from "../src/lib/workflow/runtimes/chat-api.js";
import { getWorkerRuntime } from "../src/lib/workflow/runtimes/registry.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-chatapi-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

let server: http.Server;
let baseUrl: string;
let lastRequest: { url?: string; headers: http.IncomingHttpHeaders; body: string } | null = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastRequest = { url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
      res.writeHead(nextResponse.status, { "content-type": "application/json" });
      res.end(JSON.stringify(nextResponse.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function request(workspaceDir: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceDir,
    unitKey: "review",
    owner: "reviewer",
    instructions: "Write the review.",
    outputs: ["reviews/review.md"],
    timeoutMs: 5_000,
    ...overrides,
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

describe("AnthropicApiRuntime", () => {
  it("writes the text blocks to the single output and maps usage", async () => {
    await withEnv({ MALACLAW_ANTHROPIC_API_KEY: "test-key" }, async () => {
      const ws = await makeWorkspace();
      nextResponse = {
        status: 200,
        body: {
          content: [{ type: "text", text: "# Review\n\nSolid." }],
          usage: { input_tokens: 100, output_tokens: 42 },
        },
      };
      const rt = new ChatApiRuntime(anthropicProvider({ baseUrl }));
      const result = await rt.runStage(request(ws));
      expect(result.outcome).toBe("success");
      expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 42 });
      expect(await fs.readFile(path.join(ws, "reviews/review.md"), "utf-8")).toContain("Solid.");
      expect(lastRequest?.url).toBe("/v1/messages");
      expect(lastRequest?.headers["x-api-key"]).toBe("test-key");
      expect(lastRequest?.headers["anthropic-version"]).toBeDefined();
    });
  });

  it("is permission_blocked without a key and unavailable in health checks", async () => {
    await withEnv({ MALACLAW_ANTHROPIC_API_KEY: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
      const ws = await makeWorkspace();
      const rt = new ChatApiRuntime(anthropicProvider({ baseUrl }));
      expect((await rt.checkAvailable()).available).toBe(false);
      expect((await rt.runStage(request(ws))).outcome).toBe("permission_blocked");
    });
  });

  it("classifies 429 as rate_limited", async () => {
    await withEnv({ MALACLAW_ANTHROPIC_API_KEY: "test-key" }, async () => {
      const ws = await makeWorkspace();
      nextResponse = { status: 429, body: { error: { message: "rate limit" } } };
      const rt = new ChatApiRuntime(anthropicProvider({ baseUrl }));
      expect((await rt.runStage(request(ws))).outcome).toBe("rate_limited");
    });
  });

  it("refuses multi-output stages", async () => {
    await withEnv({ MALACLAW_ANTHROPIC_API_KEY: "test-key" }, async () => {
      const ws = await makeWorkspace();
      const rt = new ChatApiRuntime(anthropicProvider({ baseUrl }));
      const result = await rt.runStage(request(ws, { outputs: ["a.md", "b.md"] }));
      expect(result.outcome).toBe("tool_missing");
    });
  });
});

describe("GeminiApiRuntime", () => {
  it("hits the model-specific endpoint and joins candidate parts", async () => {
    await withEnv({ MALACLAW_GEMINI_API_KEY: "g-key" }, async () => {
      const ws = await makeWorkspace();
      nextResponse = {
        status: 200,
        body: {
          candidates: [{ content: { parts: [{ text: "# Review" }, { text: "\n\nGood." }] } }],
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 },
        },
      };
      const rt = new ChatApiRuntime(geminiProvider({ baseUrl }));
      const result = await rt.runStage(request(ws, { model: "gemini-2.5-pro" }));
      expect(result.outcome).toBe("success");
      expect(result.usage).toEqual({ input_tokens: 80, output_tokens: 20 });
      expect(lastRequest?.url).toContain("/v1beta/models/gemini-2.5-pro:generateContent");
      expect(lastRequest?.headers["x-goog-api-key"]).toBe("g-key");
      expect(await fs.readFile(path.join(ws, "reviews/review.md"), "utf-8")).toBe("# Review\n\nGood.");
    });
  });
});

describe("registry", () => {
  it("registers anthropic-api, gemini-api, and the ollama alias", () => {
    expect(getWorkerRuntime("anthropic-api").id).toBe("anthropic-api");
    expect(getWorkerRuntime("gemini-api").id).toBe("gemini-api");
    expect(getWorkerRuntime("ollama").id).toBe("ollama");
  });
});
