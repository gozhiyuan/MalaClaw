import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow } from "../src/lib/workflow/engine.js";
import { superviseFlow, readSupervisorRecord } from "../src/lib/workflow/supervisor.js";
import { acquireFlowLock, releaseFlowLock, FlowLockHeldError, readFlowLock } from "../src/lib/workflow/lock.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { registerWorkerRuntime } from "../src/lib/workflow/runtimes/registry.js";
import { readEvents } from "../src/lib/workflow/state.js";
import { summarizeUsage } from "../src/commands/flow.js";
import type { StageRunRequest, StageRunResult } from "../src/lib/workflow/runtimes/base.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-supervise-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe("flow lock", () => {
  it("blocks a second live holder and releases cleanly", async () => {
    const ws = await makeWorkspace();
    const lock = await acquireFlowLock(ws, "test-a");
    // The same PID is not re-entrant: each holder has an ownership token.
    await expect(acquireFlowLock(ws, "test-a-again")).rejects.toBeInstanceOf(FlowLockHeldError);
    await releaseFlowLock(ws, lock);
    expect(await readFlowLock(ws)).toBeNull();
  });

  it("steals a stale lock from a dead pid but respects live ones", async () => {
    const ws = await makeWorkspace();
    const flowDir = path.join(ws, ".malaclaw", "flow");
    await fs.mkdir(flowDir, { recursive: true });
    await fs.writeFile(
      path.join(flowDir, "lock.json"),
      JSON.stringify({ pid: 999999999, holder: "ghost", acquiredAt: "2026-01-01" }),
      "utf-8",
    );
    const lock = await acquireFlowLock(ws, "reclaimer");
    expect(lock).toMatchObject({ holder: "reclaimer" });
    await releaseFlowLock(ws, lock);
  });
});

/** Runtime whose named unit is quota-blocked for the first N supervise
 *  rounds, then succeeds. */
function quotaThenSuccess(unitKey: string, blockedRounds: number) {
  const inner = new DryRunRuntime();
  let blocks = 0;
  return {
    id: "dry-run",
    capabilities: inner.capabilities,
    checkAvailable: () => inner.checkAvailable(),
    async runStage(req: StageRunRequest): Promise<StageRunResult> {
      if (req.unitKey === unitKey && blocks < blockedRounds) {
        blocks += 1;
        return { outcome: "quota_exhausted", producedFiles: [], message: "plan limit reached" };
      }
      return inner.runStage(req);
    },
  };
}

describe("superviseFlow", () => {
  it("retries through quota blockers with backoff and completes", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [
        { id: "a", owner: "pm", outputs: ["a.md"] },
        { id: "b", owner: "pm", outputs: ["b.md"] },
      ],
    });
    const delays: number[] = [];
    const state = await superviseFlow({
      workflow: wf,
      workspaceDir: ws,
      runtime: quotaThenSuccess("b", 2),
      baseRetryMs: 100,
      maxRetryMs: 150,
      sleep: async (ms) => { delays.push(ms); },
    });
    expect(state.status).toBe("completed");
    expect(delays).toEqual([100, 150]); // exponential, capped
    const record = await readSupervisorRecord(ws);
    expect(record?.retries).toBe(2);
    expect(record?.lastStatus).toBe("completed");
    const events = await readEvents(ws);
    expect(events.filter((e) => e.type === "supervisor_retry_scheduled")).toHaveLength(2);
  });

  it("waits on approvals without auto-approving, then continues after a human acts", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [
        { id: "outline", owner: "pm", outputs: ["outline.md"], requires_human_approval: true },
        { id: "draft", owner: "pm", outputs: ["draft.md"] },
      ],
    });
    let approvalPolls = 0;
    const state = await superviseFlow({
      workflow: wf,
      workspaceDir: ws,
      runtime: new DryRunRuntime(),
      approvalPollMs: 10,
      sleep: async () => {
        approvalPolls += 1;
        if (approvalPolls === 2) {
          // The "human": approve via the real API while the supervisor waits.
          const { approveFlow } = await import("../src/lib/workflow/engine.js");
          const current = JSON.parse(await fs.readFile(path.join(ws, ".malaclaw/flow/state.json"), "utf-8"));
          await approveFlow(ws, current.pendingApprovals[0].id);
        }
      },
    });
    expect(state.status).toBe("completed");
    expect(approvalPolls).toBeGreaterThanOrEqual(2);
    const record = await readSupervisorRecord(ws);
    expect(record?.lastStatus).toBe("completed");
  });

  it("stops at the deadline leaving the flow paused and resumable", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{ id: "a", owner: "pm", outputs: ["a.md"] }],
    });
    const state = await superviseFlow({
      workflow: wf,
      workspaceDir: ws,
      runtime: quotaThenSuccess("a", 99),
      baseRetryMs: 5,
      maxDurationMs: 1, // immediately past deadline after first block
      sleep: async () => {},
    });
    expect(state.status).toBe("paused_blocker");
    // Resumable afterwards once quota is back.
    const resumed = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(resumed.status).toBe("completed");
  });

  it("stops for a configured run limit instead of retrying it as quota", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      run_limits: { max_recorded_tokens: 10 },
      stages: [
        { id: "a", owner: "pm", outputs: ["a.md"] },
        { id: "b", owner: "pm", outputs: ["b.md"] },
      ],
    });
    const inner = new DryRunRuntime();
    const runtime = {
      id: "dry-run", capabilities: inner.capabilities, checkAvailable: () => inner.checkAvailable(),
      async runStage(req: StageRunRequest): Promise<StageRunResult> {
        return { ...(await inner.runStage(req)), usage: { total_tokens: 10 } };
      },
    };
    const delays: number[] = [];
    const state = await superviseFlow({
      workflow: wf, workspaceDir: ws, runtime,
      sleep: async (ms) => { delays.push(ms); },
    });
    expect(state.status).toBe("paused_blocker");
    expect(delays).toEqual([]);
    const record = await readSupervisorRecord(ws);
    expect(record).toMatchObject({ blockerKind: "run_limit", retries: 0 });
  });
});

describe("explicit quota fallback", () => {
  it("falls back only when declared and capability-compatible, recording the switch", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      runtime_policy: { primary: "dry-run", fallback: ["script", "dry-run"], on_quota_exhausted: "try_fallback" },
      stages: [{ id: "a", owner: "pm", outputs: ["a.md"], command: { cmd: process.execPath, args: ["-e", "require('fs').writeFileSync('a.md','# a')"] } }],
    });
    const primary = {
      id: "dry-run",
      capabilities: new DryRunRuntime().capabilities,
      checkAvailable: () => new DryRunRuntime().checkAvailable(),
      async runStage(): Promise<StageRunResult> {
        return { outcome: "quota_exhausted", producedFiles: [], message: "plan limit" };
      },
    };
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: primary });
    expect(state.status).toBe("completed");
    expect(state.units.a.actualRuntime).toBe("script");
    const events = await readEvents(ws);
    const fallback = events.find((e) => e.type === "runtime_fallback");
    expect(fallback).toMatchObject({ from: "dry-run", to: "script", reason: "quota_exhausted" });
  });

  it("pauses as before when no fallback is declared", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      runtime_policy: { primary: "dry-run", on_quota_exhausted: "try_fallback" },
      stages: [{ id: "a", owner: "pm", outputs: ["a.md"] }],
    });
    const primary = {
      id: "dry-run",
      capabilities: new DryRunRuntime().capabilities,
      checkAvailable: () => new DryRunRuntime().checkAvailable(),
      async runStage(): Promise<StageRunResult> {
        return { outcome: "quota_exhausted", producedFiles: [], message: "plan limit" };
      },
    };
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: primary });
    expect(state.status).toBe("paused_blocker");
  });

  it("uses the fallback provider model rather than the primary tier model", async () => {
    const ws = await makeWorkspace();
    const fallbackId = "test-fallback-model";
    let fallbackModel: string | undefined;
    registerWorkerRuntime({
      id: fallbackId,
      capabilities: new DryRunRuntime().capabilities,
      checkAvailable: () => new DryRunRuntime().checkAvailable(),
      async runStage(req: StageRunRequest): Promise<StageRunResult> {
        fallbackModel = req.model;
        return new DryRunRuntime().runStage(req);
      },
    });
    const wf = WorkflowDef.parse({
      runtime_policy: {
        primary: "dry-run",
        fallback: [{ runtime: fallbackId, model: "fallback-model" }],
        on_quota_exhausted: "try_fallback",
      },
      model_tiers: { primary: { runtime: "dry-run", model: "primary-model" } },
      stages: [{ id: "a", owner: "pm", outputs: ["a.md"], model_tier: "primary" }],
    });
    const primary = {
      id: "dry-run", capabilities: new DryRunRuntime().capabilities,
      checkAvailable: () => new DryRunRuntime().checkAvailable(),
      async runStage(): Promise<StageRunResult> {
        return { outcome: "quota_exhausted", producedFiles: [], usage: { total_tokens: 7 } };
      },
    };
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: primary });
    expect(state.status).toBe("completed");
    expect(fallbackModel).toBe("fallback-model");
    expect(state.units.a).toMatchObject({ requestedModel: "primary-model", actualModel: "fallback-model" });
  });

  it("includes quota-blocked attempt usage in the usage summary", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({ stages: [{ id: "a", owner: "pm", outputs: ["a.md"] }] });
    const primary = {
      id: "dry-run", capabilities: new DryRunRuntime().capabilities,
      checkAvailable: () => new DryRunRuntime().checkAvailable(),
      async runStage(): Promise<StageRunResult> {
        return { outcome: "quota_exhausted", producedFiles: [], usage: { total_tokens: 123 } };
      },
    };
    await runFlow({ workflow: wf, workspaceDir: ws, runtime: primary });
    await expect(summarizeUsage(ws)).resolves.toMatchObject({ totalTokens: 123, unitsWithUsage: 1 });
  });
});
