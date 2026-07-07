import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeRuntime } from "../src/lib/workflow/runtimes/claude-code.js";
import { CodexRuntime, parseCodexTokensUsed } from "../src/lib/workflow/runtimes/codex.js";
import { classifyCliFailure, collectProducedFiles } from "../src/lib/workflow/runtimes/classify.js";
import { runSubprocess } from "../src/lib/workflow/runtimes/subprocess.js";
import { getWorkerRuntime, listWorkerRuntimes } from "../src/lib/workflow/runtimes/registry.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-real-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

/** Stub "CLI": node -e <script>. argsOverride bypasses the real flag set. */
function stub(script: string): { bin: string; argsOverride: string[] } {
  return { bin: process.execPath, argsOverride: ["-e", script] };
}

function request(workspaceDir: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceDir,
    unitKey: "draft",
    owner: "pm",
    instructions: "Write plan.md",
    outputs: ["plan.md"],
    timeoutMs: 5_000,
    ...overrides,
  };
}

describe("runSubprocess", () => {
  it("captures combined output and exit code, writes the log", async () => {
    const ws = await makeWorkspace();
    const logPath = path.join(ws, "out.log");
    const result = await runSubprocess({
      bin: process.execPath,
      args: ["-e", "console.log('hello'); console.error('world');"],
      cwd: ws,
      timeoutMs: 5_000,
      logPath,
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("hello");
    expect(result.output).toContain("world");
    expect(await fs.readFile(logPath, "utf-8")).toContain("hello");
  });

  it("feeds stdin and reports timeouts", async () => {
    const ws = await makeWorkspace();
    const echoed = await runSubprocess({
      bin: process.execPath,
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      cwd: ws,
      stdinText: "the contract",
      timeoutMs: 5_000,
      logPath: path.join(ws, "a.log"),
    });
    expect(echoed.output).toContain("the contract");

    const slow = await runSubprocess({
      bin: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      cwd: ws,
      timeoutMs: 100,
      logPath: path.join(ws, "b.log"),
    });
    expect(slow.timedOut).toBe(true);
  });

  it("reports spawn errors for missing binaries", async () => {
    const ws = await makeWorkspace();
    const result = await runSubprocess({
      bin: "/nonexistent/definitely-not-a-cli",
      args: [],
      cwd: ws,
      timeoutMs: 1_000,
      logPath: path.join(ws, "c.log"),
    });
    expect(result.spawnError).toBeTruthy();
  });
});

describe("classifyCliFailure", () => {
  it("classifies known failure shapes", () => {
    expect(classifyCliFailure("Error: 429 rate limit exceeded")).toBe("rate_limited");
    expect(classifyCliFailure("You have hit your usage limit for today")).toBe("quota_exhausted");
    expect(classifyCliFailure("Claude requested permissions to use Bash, but permission was denied")).toBe("permission_blocked");
    expect(classifyCliFailure("model 'nope-9000' not found")).toBe("model_unavailable");
    expect(classifyCliFailure("segfault in the matrix")).toBe("worker_error");
  });
});

describe("collectProducedFiles", () => {
  it("reports only existing concrete outputs and skips unsafe paths", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws, "plan.md"), "x", "utf-8");
    const produced = await collectProducedFiles(ws, [
      "plan.md",
      "missing.md",
      "chapters/*.md",
      "../escape.md",
    ]);
    expect(produced).toEqual(["plan.md"]);
  });
});

describe("ClaudeCodeRuntime (stubbed)", () => {
  it("parses the JSON result envelope into success + usage", async () => {
    const ws = await makeWorkspace();
    const rt = new ClaudeCodeRuntime(stub(
      `require('fs').writeFileSync('plan.md','# plan');` +
      `console.log(JSON.stringify({result:'done',is_error:false,total_cost_usd:0.12,usage:{input_tokens:10,output_tokens:5}}))`,
    ));
    const result = await rt.runStage(request(ws));
    expect(result.outcome).toBe("success");
    expect(result.producedFiles).toEqual(["plan.md"]);
    expect(result.usage?.cost_usd).toBe(0.12);
    expect(result.usage?.input_tokens).toBe(10);
  });

  it("classifies rate limits and quota exhaustion from failing runs", async () => {
    const ws = await makeWorkspace();
    const rateLimited = new ClaudeCodeRuntime(stub(
      `console.error('API Error: 429 rate limit exceeded'); process.exit(1)`,
    ));
    expect((await rateLimited.runStage(request(ws))).outcome).toBe("rate_limited");

    const quota = new ClaudeCodeRuntime(stub(
      `console.error('You have reached your usage limit'); process.exit(1)`,
    ));
    expect((await quota.runStage(request(ws))).outcome).toBe("quota_exhausted");
  });

  it("respects the is_error envelope even on exit 0", async () => {
    const ws = await makeWorkspace();
    const rt = new ClaudeCodeRuntime(stub(
      `console.log(JSON.stringify({result:'Credit balance too low',is_error:true}))`,
    ));
    expect((await rt.runStage(request(ws))).outcome).toBe("quota_exhausted");
  });

  it("times out runaway workers", async () => {
    const ws = await makeWorkspace();
    const rt = new ClaudeCodeRuntime(stub(`setTimeout(() => {}, 60000)`));
    const result = await rt.runStage(request(ws, { timeoutMs: 100 }));
    expect(result.outcome).toBe("timeout");
  });

  it("checkAvailable reflects a working binary and a missing one", async () => {
    const ok = new ClaudeCodeRuntime({ bin: process.execPath });
    expect((await ok.checkAvailable()).available).toBe(true);
    const missing = new ClaudeCodeRuntime({ bin: "/nonexistent/claude" });
    expect((await missing.checkAvailable()).available).toBe(false);
  });
});

describe("parseCodexTokensUsed", () => {
  it("parses the number-on-next-line trailer with thousands separators", () => {
    expect(parseCodexTokensUsed("...review text...\n\ntokens used\n17,936\nCreated the output.")).toBe(17_936);
  });

  it("parses the same-line colon format and prefers the last occurrence", () => {
    expect(parseCodexTokensUsed("tokens used: 500\n...more work...\ntokens used: 1,200")).toBe(1_200);
  });

  it("returns undefined when no trailer is present", () => {
    expect(parseCodexTokensUsed("no telemetry here")).toBeUndefined();
    expect(parseCodexTokensUsed("tokens used\nnot-a-number")).toBeUndefined();
  });
});

describe("CodexRuntime (stubbed)", () => {
  it("uses MALACLAW_CODEX_BIN when the CLI is not on PATH", async () => {
    const previous = process.env.MALACLAW_CODEX_BIN;
    process.env.MALACLAW_CODEX_BIN = process.execPath;
    try {
      const rt = new CodexRuntime();
      expect((await rt.checkAvailable()).available).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MALACLAW_CODEX_BIN;
      else process.env.MALACLAW_CODEX_BIN = previous;
    }
  });

  it("keeps explicit bin option ahead of MALACLAW_CODEX_BIN", async () => {
    const previous = process.env.MALACLAW_CODEX_BIN;
    process.env.MALACLAW_CODEX_BIN = "/nonexistent/codex";
    try {
      const rt = new CodexRuntime({ bin: process.execPath });
      expect((await rt.checkAvailable()).available).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MALACLAW_CODEX_BIN;
      else process.env.MALACLAW_CODEX_BIN = previous;
    }
  });

  it("succeeds on exit 0 and reports produced files", async () => {
    const ws = await makeWorkspace();
    const rt = new CodexRuntime(stub(
      `require('fs').writeFileSync('plan.md','# plan'); console.log('done')`,
    ));
    const result = await rt.runStage(request(ws));
    expect(result.outcome).toBe("success");
    expect(result.producedFiles).toEqual(["plan.md"]);
  });

  it("captures the tokens-used trailer as usage on success", async () => {
    const ws = await makeWorkspace();
    const rt = new CodexRuntime(stub(
      `require('fs').writeFileSync('plan.md','# plan'); console.log('tokens used\\n17,936')`,
    ));
    const result = await rt.runStage(request(ws));
    expect(result.outcome).toBe("success");
    expect(result.usage).toEqual({ total_tokens: 17_936 });
  });

  it("classifies failures from output text", async () => {
    const ws = await makeWorkspace();
    const rt = new CodexRuntime(stub(
      `console.error('stream error: rate limit reached'); process.exit(1)`,
    ));
    expect((await rt.runStage(request(ws))).outcome).toBe("rate_limited");
  });
});

describe("registry", () => {
  it("registers claude-code and codex", () => {
    expect(getWorkerRuntime("claude-code").id).toBe("claude-code");
    expect(getWorkerRuntime("codex").id).toBe("codex");
    expect(listWorkerRuntimes().map((runtime) => runtime.id)).toEqual(expect.arrayContaining([
      "dry-run",
      "script",
      "claude-code",
      "codex",
      "openai-compatible",
      "openai-api",
    ]));
  });
});

// Real-CLI integration: opt in with MALACLAW_REAL_RUNTIME_TESTS=1 (needs a
// logged-in claude CLI; costs a few cents).
describe.runIf(process.env.MALACLAW_REAL_RUNTIME_TESTS === "1")("claude-code (real)", () => {
  it("runs a trivial stage end to end", async () => {
    const ws = await makeWorkspace();
    const rt = new ClaudeCodeRuntime();
    const result = await rt.runStage(request(ws, {
      instructions: "Create a file named hello.md containing exactly: hello from malaclaw",
      outputs: ["hello.md"],
      timeoutMs: 300_000,
    }));
    expect(result.outcome).toBe("success");
    expect(result.producedFiles).toEqual(["hello.md"]);
  }, 300_000);
});
