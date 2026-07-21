import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow, approveFlow, cancelFlow, recoverOrphanedFlow, getFlowStatus, pauseFlow, resumeFlow, retryFailedFlow, migrateFlow, reopenFlowFrom } from "../src/lib/workflow/engine.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { readEvents } from "../src/lib/workflow/state.js";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "../src/lib/workflow/runtimes/base.js";
import { CLI_HARNESS_CAPABILITIES } from "../src/lib/workflow/runtimes/base.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-eng-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

const simpleWf = WorkflowDef.parse({
  stages: [
    { id: "plan", owner: "pm", outputs: ["plan.md"], validators: ["required_output_exists"] },
    { id: "build", owner: "tech-lead", inputs: ["plan.md"], outputs: ["result.md"] },
  ],
});

describe("runFlow", () => {
  it("honors a safe-point pause after the active unit and resumes without repeating it", async () => {
    const ws = await makeWorkspace();
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const runtime: WorkerRuntime = {
      // The engine's capability preflight resolves declared runtime IDs from
      // its registry; retain dry-run's ID while replacing execution behavior.
      id: "dry-run",
      capabilities: CLI_HARNESS_CAPABILITIES,
      async checkAvailable(): Promise<RuntimeHealth> { return { available: true, supports_headless: true }; },
      async runStage(req: StageRunRequest): Promise<StageRunResult> {
        started?.();
        await new Promise<void>((resolve) => { release = resolve; });
        for (const output of req.outputs) await fs.writeFile(path.join(req.workspaceDir, output), "done", "utf-8");
        return { outcome: "success", producedFiles: req.outputs };
      },
    };
    const running = runFlow({ workflow: simpleWf, workspaceDir: ws, runtime });
    await startedPromise;
    await pauseFlow(ws);
    release?.();
    const paused = await running;
    expect(paused.status).toBe("paused_by_operator");
    expect(paused.units.plan.status).toBe("succeeded");
    expect(paused.units.build.status).toBe("pending");

    const resumed = await resumeFlow(ws);
    expect(resumed.status).toBe("idle");
    const completed = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(completed.status).toBe("completed");
    const events = await readEvents(ws);
    expect(events.filter((event) => event.type === "unit_started" && event.key === "plan")).toHaveLength(1);
  });

  it("cancels an in-flight abortable worker and leaves its unit pending", async () => {
    const ws = await makeWorkspace();
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const runtime: WorkerRuntime = {
      id: "dry-run",
      capabilities: CLI_HARNESS_CAPABILITIES,
      async checkAvailable(): Promise<RuntimeHealth> { return { available: true, supports_headless: true }; },
      async runStage(req: StageRunRequest): Promise<StageRunResult> {
        started?.();
        return new Promise((resolve) => req.abortSignal?.addEventListener("abort", () =>
          resolve({ outcome: "cancelled", producedFiles: [], message: "cancelled by test" }), { once: true }));
      },
    };
    const running = runFlow({ workflow: simpleWf, workspaceDir: ws, runtime });
    await startedPromise;
    await cancelFlow(ws);
    const cancelled = await running;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.units.plan.status).toBe("pending");
    await expect(runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() })).rejects.toThrow(/flow resume/i);
  });

  it("recovers an orphaned running unit without resetting completed checkpoints", async () => {
    const ws = await makeWorkspace();
    await fs.mkdir(path.join(ws, ".malaclaw", "flow"), { recursive: true });
    const running = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(running.status).toBe("completed");
    // Model the durable state left by a scheduler crash after the first stage.
    const statePath = path.join(ws, ".malaclaw", "flow", "state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf-8"));
    state.status = "running";
    state.units.build = { status: "running", attempts: 1, rounds: 0, approvalGranted: false, budgetApproved: false };
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    const recovered = await recoverOrphanedFlow(ws);
    expect(recovered.status).toBe("cancelled");
    expect(recovered.units.plan.status).toBe("succeeded");
    expect(recovered.units.build.status).toBe("pending");
  });

  it("runs sequential stages to completion and writes artifacts + events", async () => {
    const ws = await makeWorkspace();
    const state = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("completed");
    expect(state.units.plan.status).toBe("succeeded");
    expect(state.units.build.status).toBe("succeeded");
    await fs.access(path.join(ws, "plan.md"));
    await fs.access(path.join(ws, "result.md"));
    const events = await readEvents(ws);
    expect(events.some((e) => e.type === "unit_succeeded" && e.key === "plan")).toBe(true);
    expect(events.some((e) => e.type === "flow_completed")).toBe(true);
  });

  it("persists prompts per attempt", async () => {
    const ws = await makeWorkspace();
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const prompt = await fs.readFile(
      path.join(ws, ".malaclaw/flow/prompts/plan-attempt1.md"), "utf-8");
    expect(prompt).toContain("Stage: plan");
  });

  it("retries with validator feedback and fails after max attempts", async () => {
    const ws = await makeWorkspace();
    // Outputs are a template the dry-run skips, so the unknown validator
    // fails every attempt and the findings feed the retry prompt.
    const wf = WorkflowDef.parse({
      stages: [{
        id: "plan", owner: "pm",
        outputs: ["chapters/*.md"],
        validators: ["required_output_exists", "unknown_gate"],
        retry: { max_attempts: 2 },
      }],
    });
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("failed");
    expect(state.units.plan.status).toBe("failed");
    expect(state.units.plan.attempts).toBe(2);
    const prompt2 = await fs.readFile(
      path.join(ws, ".malaclaw/flow/prompts/plan-attempt2.md"), "utf-8");
    expect(prompt2).toContain("Previous attempt failed");
    expect(prompt2).toContain("unknown_gate");
  });

  it("explicitly retries failed units without resetting completed work", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [
        { id: "plan", owner: "pm", outputs: ["plan.md"] },
        { id: "build", owner: "pm", inputs: ["plan.md"], outputs: ["result.md"], retry: { max_attempts: 1 } },
      ],
    });
    const failed = await runFlow({
      workflow: wf, workspaceDir: ws,
      runtime: new DryRunRuntime({ outcomes: { build: ["worker_error"] } }),
    });
    expect(failed.status).toBe("failed");
    expect(failed.units.plan.status).toBe("succeeded");
    expect(failed.units.build.status).toBe("failed");

    const reset = await retryFailedFlow(ws);
    expect(reset.status).toBe("idle");
    expect(reset.units.plan.status).toBe("succeeded");
    expect(reset.units.build).toMatchObject({ status: "pending", attempts: 0 });

    const completed = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(completed.status).toBe("completed");
    const events = await readEvents(ws);
    expect(events.filter((event) => event.type === "unit_started" && event.key === "plan")).toHaveLength(1);
    expect(events.some((event) => event.type === "flow_retry_requested")).toBe(true);
  });

  it("migrates an additive workflow update without resetting completed units", async () => {
    const ws = await makeWorkspace();
    const completed = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(completed.status).toBe("completed");
    const expanded = WorkflowDef.parse({
      stages: [...simpleWf.stages, { id: "final_validate", owner: "pm", inputs: ["result.md"], outputs: ["validation.md"] }],
    });
    const migrated = await migrateFlow(ws, expanded);
    expect(migrated.status).toBe("idle");
    expect(migrated.units.plan.status).toBe("succeeded");
    expect(migrated.units.final_validate.status).toBe("pending");

    const resumed = await runFlow({ workflow: expanded, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(resumed.status).toBe("completed");
    await fs.access(path.join(ws, "validation.md"));
    const events = await readEvents(ws);
    expect(events.some((event) => event.type === "flow_migrated")).toBe(true);
  });

  it("reopens a selected top-level stage and downstream work only", async () => {
    const ws = await makeWorkspace();
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const reopened = await reopenFlowFrom(ws, simpleWf, "build");
    expect(reopened.units.plan.status).toBe("succeeded");
    expect(reopened.units.build.status).toBe("pending");

    const completed = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(completed.status).toBe("completed");
    const events = await readEvents(ws);
    expect(events.filter((event) => event.type === "unit_started" && event.key === "plan")).toHaveLength(1);
    expect(events.filter((event) => event.type === "unit_started" && event.key === "build")).toHaveLength(2);
    expect(events.some((event) => event.type === "flow_reopened" && event.from_stage === "build")).toBe(true);
  });

  it("pauses at an approval gate, then resumes after approveFlow", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [
        { id: "outline", owner: "pm", outputs: ["outline.md"], requires_human_approval: true },
        { id: "draft", owner: "pm", outputs: ["draft.md"] },
      ],
    });
    const runtime = new DryRunRuntime();
    const paused = await runFlow({ workflow: wf, workspaceDir: ws, runtime });
    expect(paused.status).toBe("paused_for_approval");
    expect(paused.pendingApprovals).toHaveLength(1);
    expect(paused.units.draft.status).toBe("pending");

    await approveFlow(ws, paused.pendingApprovals[0].id);
    const resumed = await runFlow({ workflow: wf, workspaceDir: ws, runtime });
    expect(resumed.status).toBe("completed");
    expect(resumed.units.draft.status).toBe("succeeded");
  });

  it("backs off and retries on rate_limited without consuming attempts", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({ outcomes: { plan: ["rate_limited", "rate_limited", "success"] } });
    const state = await runFlow({
      workflow: simpleWf, workspaceDir: ws, runtime, backoffMs: 0,
    });
    expect(state.status).toBe("completed");
    expect(state.units.plan.attempts).toBe(1);
  });

  it("pauses with a blocker report on quota_exhausted", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({ outcomes: { plan: ["quota_exhausted"] } });
    const state = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime });
    expect(state.status).toBe("paused_blocker");
    expect(state.units.plan.status).toBe("pending");
    const blocker = await fs.readFile(path.join(ws, "reports/plan-blocker.md"), "utf-8");
    expect(blocker).toContain("quota_exhausted");
  });

  it("resumes from saved state after interruption (blocker cleared)", async () => {
    const ws = await makeWorkspace();
    const first = new DryRunRuntime({ outcomes: { build: ["quota_exhausted"] } });
    const paused = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: first });
    expect(paused.status).toBe("paused_blocker");
    expect(paused.units.plan.status).toBe("succeeded");

    const second = new DryRunRuntime();
    const resumed = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: second });
    expect(resumed.status).toBe("completed");
    // plan was NOT re-run on resume
    const events = await readEvents(ws);
    const planRuns = events.filter((e) => e.type === "unit_started" && e.key === "plan");
    expect(planRuns).toHaveLength(1);
  });

  it("checkpoints existing outputs before overwriting", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws, "plan.md"), "precious human draft", "utf-8");
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const checkpoints = await fs.readdir(path.join(ws, ".malaclaw/flow/checkpoints"));
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    const saved = await fs.readFile(
      path.join(ws, ".malaclaw/flow/checkpoints", checkpoints[0], "plan.md"), "utf-8");
    expect(saved).toBe("precious human draft");
  });

  it("rejects a stale state hash unless reset is passed", async () => {
    const ws = await makeWorkspace();
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const changed = WorkflowDef.parse({
      stages: [{ id: "plan", owner: "pm", outputs: ["plan.md"] }],
    });
    await expect(
      runFlow({ workflow: changed, workspaceDir: ws, runtime: new DryRunRuntime() }),
    ).rejects.toThrow(/changed|reset/i);
    const state = await runFlow({
      workflow: changed, workspaceDir: ws, runtime: new DryRunRuntime(), reset: true,
    });
    expect(state.status).toBe("completed");
  });

  it("resets same-hash completed state when explicitly requested", async () => {
    const ws = await makeWorkspace();
    const first = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(first.units.plan.attempts).toBe(1);
    const reset = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime(), reset: true });
    expect(reset.status).toBe("completed");
    // A fresh state has one new attempt rather than returning the old state.
    expect(reset.units.plan.attempts).toBe(1);
    const events = await readEvents(ws);
    expect(events.filter((event) => event.type === "flow_initialized")).toHaveLength(2);
  });

  it("runs a foreach stage after a producer emits an item artifact", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [
        { id: "outline", owner: "pm", outputs: ["outline.json"] },
        {
          type: "foreach", id: "items", foreach: "outline.sections",
          steps: [{ id: "draft", owner: "pm", outputs: ["chapters/{{item.id}}.md"] }],
        },
      ],
    });
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("completed");
    expect(state.units["items.draft[section-1]"].status).toBe("succeeded");
  });

  it("dispatches a stage to the script runtime when requested", async () => {
    const ws = await makeWorkspace();
    const script = path.join(ws, "write-plan.mjs");
    await fs.writeFile(script, "import fs from 'node:fs/promises'; await fs.writeFile('plan.md', '# plan');\n", "utf-8");
    const wf = WorkflowDef.parse({
      stages: [
        {
          id: "plan",
          owner: "pm",
          runtime: "script",
          command: { cmd: process.execPath, args: [script] },
          outputs: ["plan.md"],
          validators: ["required_output_exists", "non_empty_markdown"],
        },
        { id: "build", owner: "pm", inputs: ["plan.md"], outputs: ["result.md"] },
      ],
    });

    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("completed");
    expect(state.units.plan.actualRuntime).toBe("script");
    expect(await fs.readFile(path.join(ws, "plan.md"), "utf-8")).toBe("# plan");
    expect(state.units.build.actualRuntime).toBe("dry-run");
  });
});

describe("getFlowStatus", () => {
  it("returns null before any run and state after", async () => {
    const ws = await makeWorkspace();
    expect(await getFlowStatus(ws)).toBeNull();
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const status = await getFlowStatus(ws);
    expect(status?.status).toBe("completed");
  });
});
