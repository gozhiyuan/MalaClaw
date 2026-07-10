import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow } from "../src/lib/workflow/engine.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { readEvents, loadFlowState } from "../src/lib/workflow/state.js";
import type { StageRunRequest, StageRunResult } from "../src/lib/workflow/runtimes/base.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-limits-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

/** Dry-run wrapper that reports fixed token usage per attempt and can fail
 *  the first attempt of chosen units (with usage attached to the failure). */
function meteredRuntime(tokensPerAttempt: number, failFirstAttemptOf: Set<string> = new Set()) {
  const inner = new DryRunRuntime();
  const attempts = new Map<string, number>();
  return {
    id: "dry-run",
    capabilities: inner.capabilities,
    checkAvailable: () => inner.checkAvailable(),
    async runStage(req: StageRunRequest): Promise<StageRunResult> {
      const n = (attempts.get(req.unitKey) ?? 0) + 1;
      attempts.set(req.unitKey, n);
      if (failFirstAttemptOf.has(req.unitKey) && n === 1) {
        return {
          outcome: "worker_error",
          producedFiles: [],
          message: "flaky first attempt",
          usage: { total_tokens: tokensPerAttempt },
        };
      }
      const result = await inner.runStage(req);
      return { ...result, usage: { total_tokens: tokensPerAttempt } };
    },
  };
}

describe("run limits", () => {
  it("pauses before the next unit once max_recorded_tokens is reached", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      run_limits: { max_recorded_tokens: 2_500 },
      stages: [
        { id: "a", owner: "pm", outputs: ["a.md"] },
        { id: "b", owner: "pm", outputs: ["b.md"] },
        { id: "c", owner: "pm", outputs: ["c.md"] },
      ],
    });
    // Guardrail semantics: the check runs BEFORE each unit, so the cap must
    // be <= one unit's recorded tokens to block the second unit. Cap 1000:
    // a records 1000, then b is blocked before starting.
    const capped = WorkflowDef.parse({ ...wf, run_limits: { max_recorded_tokens: 1_000 } });
    const state = await runFlow({ workflow: capped, workspaceDir: ws, runtime: meteredRuntime(1_000) });

    expect(state.status).toBe("paused_blocker");
    expect(state.units.a.status).toBe("succeeded");
    expect(state.units.b.status).toBe("pending"); // blocked before starting
    expect(state.telemetry.recordedTokens).toBe(1_000);

    const blocker = await fs.readFile(path.join(ws, "reports", "run-limits-blocker.md"), "utf-8");
    expect(blocker).toContain("max_recorded_tokens");
    const events = await readEvents(ws);
    expect(events.some((e) => e.type === "run_limit_reached")).toBe(true);
  });

  it("records failed-attempt usage so retries never undercount", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{ id: "a", owner: "pm", outputs: ["a.md"], retry: { max_attempts: 3 } }],
    });
    const state = await runFlow({
      workflow: wf, workspaceDir: ws,
      runtime: meteredRuntime(1_000, new Set(["a"])),
    });
    expect(state.status).toBe("completed");
    // 1 failed + 1 successful attempt = 2000 tokens recorded.
    expect(state.telemetry.recordedTokens).toBe(2_000);
    const events = await readEvents(ws);
    const failedEvent = events.find((e) => e.type === "unit_attempt_failed");
    expect((failedEvent as { usage?: { total_tokens?: number } }).usage?.total_tokens).toBe(1_000);
  });

  it("telemetry and limit state survive pause and resume", async () => {
    const ws = await makeWorkspace();
    const limited = WorkflowDef.parse({
      run_limits: { max_recorded_tokens: 1_000 },
      stages: [
        { id: "a", owner: "pm", outputs: ["a.md"] },
        { id: "b", owner: "pm", outputs: ["b.md"] },
      ],
    });
    await runFlow({ workflow: limited, workspaceDir: ws, runtime: meteredRuntime(1_000) });
    const paused = await loadFlowState(ws);
    expect(paused?.telemetry.recordedTokens).toBe(1_000);

    // Operator raises the limit; the resumed run finishes and accumulates.
    const raised = WorkflowDef.parse({
      run_limits: { max_recorded_tokens: 100_000 },
      stages: limited.stages,
    });
    const done = await runFlow({ workflow: raised, workspaceDir: ws, runtime: meteredRuntime(1_000), reset: false });
    expect(done.status).toBe("completed");
    expect(done.telemetry.recordedTokens).toBe(2_000);
  });

  it("respects max_unit_minutes as the per-unit timeout", async () => {
    const ws = await makeWorkspace();
    const seen: number[] = [];
    const inner = new DryRunRuntime();
    const spy = {
      id: "dry-run",
      capabilities: inner.capabilities,
      checkAvailable: () => inner.checkAvailable(),
      runStage: async (req: StageRunRequest) => {
        seen.push(req.timeoutMs);
        return inner.runStage(req);
      },
    };
    const wf = WorkflowDef.parse({
      run_limits: { max_unit_minutes: 2 },
      stages: [{ id: "a", owner: "pm", outputs: ["a.md"] }],
    });
    await runFlow({ workflow: wf, workspaceDir: ws, runtime: spy });
    expect(seen[0]).toBe(120_000);
  });
});

describe("owner role injection", () => {
  it("injects roles/<owner>.md and keeps owners distinct", async () => {
    const ws = await makeWorkspace();
    await fs.mkdir(path.join(ws, "roles"), { recursive: true });
    await fs.writeFile(path.join(ws, "roles", "research-lead.md"), "# Research Lead\nNever fabricate citations.", "utf-8");
    await fs.writeFile(path.join(ws, "roles", "skeptical-reviewer.md"), "# Skeptical Reviewer\nDefault to major revision.", "utf-8");
    const prompts = new Map<string, string>();
    const inner = new DryRunRuntime();
    const spy = {
      id: "dry-run",
      capabilities: inner.capabilities,
      checkAvailable: () => inner.checkAvailable(),
      runStage: async (req: StageRunRequest) => {
        prompts.set(req.unitKey, req.instructions);
        return inner.runStage(req);
      },
    };
    const wf = WorkflowDef.parse({
      stages: [
        { id: "intake", owner: "research-lead", outputs: ["brief.md"] },
        { id: "review", owner: "skeptical-reviewer", outputs: ["review.md"] },
        { id: "build", owner: "artifact-builder", outputs: ["final.md"] }, // no role file
      ],
    });
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: spy });
    expect(state.status).toBe("completed");
    expect(prompts.get("intake")).toContain('acting as the "research-lead" role');
    expect(prompts.get("intake")).toContain("Never fabricate citations.");
    expect(prompts.get("review")).toContain("Default to major revision.");
    expect(prompts.get("review")).not.toContain("Never fabricate citations.");
    // Owner without a role file stays a plain label — no role section.
    expect(prompts.get("build")).not.toContain("acting as the");
  });
});
