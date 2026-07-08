import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { ScriptRuntime } from "../src/lib/workflow/runtimes/script.js";
import { getWorkerRuntime, registerWorkerRuntime } from "../src/lib/workflow/runtimes/registry.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-dry-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

function request(workspaceDir: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceDir,
    unitKey: "plan",
    owner: "pm",
    instructions: "Write the plan.",
    outputs: ["plan.md"],
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("DryRunRuntime", () => {
  it("reports healthy and headless", async () => {
    const rt = new DryRunRuntime();
    const health = await rt.checkAvailable();
    expect(health.available).toBe(true);
    expect(health.supports_headless).toBe(true);
  });

  it("writes each declared output deterministically", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime();
    const result = await rt.runStage(request(ws, { outputs: ["plan.md", "notes/decisions.md"] }));
    expect(result.outcome).toBe("success");
    expect(result.producedFiles).toEqual(["plan.md", "notes/decisions.md"]);
    const content = await fs.readFile(path.join(ws, "plan.md"), "utf-8");
    expect(content).toContain("dry-run");
    expect(content).toContain("plan");
    const nested = await fs.readFile(path.join(ws, "notes/decisions.md"), "utf-8");
    expect(nested.length).toBeGreaterThan(0);
  });

  it("uses fixture content when provided", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime({ fixtures: { "plan.md": "# The Real Plan" } });
    await rt.runStage(request(ws));
    const content = await fs.readFile(path.join(ws, "plan.md"), "utf-8");
    expect(content).toBe("# The Real Plan");
  });

  it("prefers workspace fixtures from .malaclaw/fixtures/<output>", async () => {
    const ws = await makeWorkspace();
    const fixtureDir = path.join(ws, ".malaclaw", "fixtures", "reviews");
    await fs.mkdir(fixtureDir, { recursive: true });
    await fs.writeFile(path.join(fixtureDir, "scorecard.json"), `{"personas":[]}`, "utf-8");
    const rt = new DryRunRuntime();
    await rt.runStage(request(ws, { outputs: ["reviews/scorecard.json"] }));
    const content = await fs.readFile(path.join(ws, "reviews", "scorecard.json"), "utf-8");
    expect(content).toBe(`{"personas":[]}`);
  });

  it("constructor fixtures beat workspace fixtures", async () => {
    const ws = await makeWorkspace();
    await fs.mkdir(path.join(ws, ".malaclaw", "fixtures"), { recursive: true });
    await fs.writeFile(path.join(ws, ".malaclaw", "fixtures", "plan.md"), "workspace", "utf-8");
    const rt = new DryRunRuntime({ fixtures: { "plan.md": "constructor" } });
    await rt.runStage(request(ws));
    expect(await fs.readFile(path.join(ws, "plan.md"), "utf-8")).toBe("constructor");
  });

  it("plays scripted outcomes per unit before succeeding", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime({ outcomes: { plan: ["rate_limited", "success"] } });
    const first = await rt.runStage(request(ws));
    expect(first.outcome).toBe("rate_limited");
    const second = await rt.runStage(request(ws));
    expect(second.outcome).toBe("success");
  });

  it("skips glob/template outputs without failing", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime();
    const result = await rt.runStage(request(ws, { outputs: ["chapters/*.md", "plan.md"] }));
    expect(result.outcome).toBe("success");
    expect(result.producedFiles).toEqual(["plan.md"]);
  });

  it("writes a deterministic items fixture for .json outputs", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime();
    await rt.runStage(request(ws, { outputs: ["outline.json"] }));
    const parsed = JSON.parse(await fs.readFile(path.join(ws, "outline.json"), "utf-8"));
    expect(parsed.sections.length).toBeGreaterThanOrEqual(2);
    expect(parsed.sections[0].id).toBeTruthy();
    expect(parsed.chapters[0].id).toBeTruthy();
  });
});

describe("runtime registry", () => {
  it("has dry-run registered by default", () => {
    expect(getWorkerRuntime("dry-run").id).toBe("dry-run");
  });

  it("has script registered by default", () => {
    expect(getWorkerRuntime("script").id).toBe("script");
  });

  it("throws a helpful error for unknown runtimes", () => {
    expect(() => getWorkerRuntime("warp-drive")).toThrow(/warp-drive/);
  });

  it("allows registering custom runtimes", () => {
    registerWorkerRuntime({
      id: "custom-test",
      checkAvailable: async () => ({ available: true, supports_headless: true }),
      runStage: async () => ({ outcome: "success", producedFiles: [] }),
    });
    expect(getWorkerRuntime("custom-test").id).toBe("custom-test");
  });
});

describe("ScriptRuntime", () => {
  it("runs a structured command in the workspace and captures logs", async () => {
    const ws = await makeWorkspace();
    const script = path.join(ws, "write-output.mjs");
    await fs.writeFile(script, "import fs from 'node:fs/promises'; await fs.writeFile('out.txt', 'ok'); console.log('done');\n", "utf-8");
    const runtime = new ScriptRuntime();
    const result = await runtime.runStage(request(ws, {
      unitKey: "scripted",
      outputs: ["out.txt"],
      command: { cmd: process.execPath, args: [script] },
      logPath: path.join(ws, "script.log"),
    }));
    expect(result.outcome).toBe("success");
    expect(await fs.readFile(path.join(ws, "out.txt"), "utf-8")).toBe("ok");
    expect(await fs.readFile(path.join(ws, "script.log"), "utf-8")).toContain("done");
  });

  it("passes stage context through environment variables", async () => {
    const ws = await makeWorkspace();
    const script = path.join(ws, "write-env.mjs");
    await fs.writeFile(
      script,
      "import fs from 'node:fs/promises'; await fs.writeFile('env.json', JSON.stringify({ key: process.env.MALACLAW_UNIT_KEY, outputs: JSON.parse(process.env.MALACLAW_STAGE_OUTPUTS) }));\n",
      "utf-8",
    );
    const runtime = new ScriptRuntime();
    const result = await runtime.runStage(request(ws, {
      unitKey: "draft_sections.draft[section-1]",
      outputs: ["env.json"],
      command: { cmd: process.execPath, args: [script] },
    }));
    expect(result.outcome).toBe("success");
    const env = JSON.parse(await fs.readFile(path.join(ws, "env.json"), "utf-8"));
    expect(env.key).toBe("draft_sections.draft[section-1]");
    expect(env.outputs).toEqual(["env.json"]);
  });

  it("fails closed without a command", async () => {
    const ws = await makeWorkspace();
    const runtime = new ScriptRuntime();
    const result = await runtime.runStage(request(ws));
    expect(result.outcome).toBe("tool_missing");
  });
});
