import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
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
});

describe("runtime registry", () => {
  it("has dry-run registered by default", () => {
    expect(getWorkerRuntime("dry-run").id).toBe("dry-run");
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
