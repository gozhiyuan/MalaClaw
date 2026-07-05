import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow, approveFlow, getFlowStatus } from "../src/lib/workflow/engine.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { readEvents } from "../src/lib/workflow/state.js";

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
