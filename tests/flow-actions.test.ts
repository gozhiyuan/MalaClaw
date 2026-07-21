import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow } from "../src/lib/workflow/engine.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { readEvents } from "../src/lib/workflow/state.js";

const tempDirs: string[] = [];
async function workspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-actions-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => { while (tempDirs.length) await fs.rm(tempDirs.pop()!, { recursive: true, force: true }); });

function workflow() {
  return WorkflowDef.parse({
    tool_catalog: [{
      id: "revise_sections",
      owner: "editor",
      inputs: ["reviews/action-plan.json"],
      outputs: ["chapters/revised.md"],
      instructions: ["Revise only the sections selected by the action plan."],
      validators: ["required_output_exists"],
    }],
    stages: [
      { id: "planner", owner: "reviewer", outputs: ["reviews/action-plan.json"] },
      {
        type: "action_dispatch",
        id: "dispatch",
        owner: "orchestrator",
        plan_path: "reviews/action-plan.json",
        allowed_actions: ["revise_sections"],
        outputs: ["reports/action-dispatch.json"],
      },
    ],
  });
}

describe("action_dispatch", () => {
  it("materializes only a selected catalog action and records its rationale", async () => {
    const ws = await workspace();
    const runtime = new DryRunRuntime({ fixtures: {
      "reviews/action-plan.json": JSON.stringify({
        version: 1,
        findings: [{ id: "short-intro", severity: "major", summary: "The introduction is materially below its target length." }],
        actions: [{ id: "expand-intro", tool: "revise_sections", finding_ids: ["short-intro"], rationale: "Expand the evidence-backed introduction before another review." }],
      }),
    } });
    const state = await runFlow({ workflow: workflow(), workspaceDir: ws, runtime });
    expect(state.status).toBe("completed");
    expect(state.units["dispatch.revise_sections[expand-intro]"].status).toBe("succeeded");
    await fs.access(path.join(ws, "chapters", "revised.md"));
    const report = JSON.parse(await fs.readFile(path.join(ws, "reports", "action-dispatch.json"), "utf-8"));
    expect(report.executions[0]).toMatchObject({ tool: "revise_sections", finding_ids: ["short-intro"] });
    const events = await readEvents(ws);
    expect(events.some((event) => event.type === "action_dispatch_completed" && event.key === "dispatch")).toBe(true);
  });

  it("rejects unknown or unapproved actions before they can execute", async () => {
    const ws = await workspace();
    const runtime = new DryRunRuntime({ fixtures: {
      "reviews/action-plan.json": JSON.stringify({
        version: 1,
        findings: [{ id: "f1", severity: "major", summary: "Need work." }],
        actions: [{ id: "unsafe", tool: "run_any_shell_command", finding_ids: ["f1"], rationale: "Should never be allowed." }],
      }),
    } });
    const state = await runFlow({ workflow: workflow(), workspaceDir: ws, runtime });
    expect(state.status).toBe("failed");
    expect(state.units.dispatch.lastError).toContain("unknown action tool");
    const report = JSON.parse(await fs.readFile(path.join(ws, "reports", "action-dispatch.json"), "utf-8"));
    expect(report.status).toBe("rejected");
    await expect(fs.access(path.join(ws, "chapters", "revised.md"))).rejects.toThrow();
  });

  it("requires budget approval for the selected catalog action, not the whole dispatcher", async () => {
    const ws = await workspace();
    const gated = WorkflowDef.parse({
      ...workflow(),
      model_tiers: { costly: { runtime: "dry-run", requires_budget_approval: true } },
      tool_catalog: [{
        id: "revise_sections", owner: "editor", inputs: ["reviews/action-plan.json"], outputs: ["chapters/revised.md"],
        instructions: ["Revise only the sections selected by the action plan."], validators: ["required_output_exists"], model_tier: "costly",
      }],
    });
    const runtime = new DryRunRuntime({ fixtures: {
      "reviews/action-plan.json": JSON.stringify({
        version: 1, findings: [{ id: "f1", severity: "major", summary: "Need work." }],
        actions: [{ id: "revise-1", tool: "revise_sections", finding_ids: ["f1"], rationale: "Repair." }],
      }),
    } });
    const state = await runFlow({ workflow: gated, workspaceDir: ws, runtime });
    expect(state.status).toBe("paused_for_approval");
    expect(state.pendingApprovals[0]?.kind).toBe("budget");
    expect(state.pendingApprovals[0]?.stageId).toBe("dispatch.revise_sections[revise-1]");
  });

  it("materializes an operator clarification then pauses before the next action", async () => {
    const ws = await workspace();
    const clarification = WorkflowDef.parse({
      tool_catalog: [{
        id: "request_operator_clarification", owner: "editor", inputs: ["reviews/action-plan.json"], outputs: ["reviews/clarification-request.md"],
        instructions: ["Write the operator question."], validators: ["required_output_exists"], requires_operator_response: true,
      }],
      stages: [
        { id: "planner", owner: "reviewer", outputs: ["reviews/action-plan.json"] },
        { type: "action_dispatch", id: "dispatch", owner: "orchestrator", plan_path: "reviews/action-plan.json", allowed_actions: ["request_operator_clarification"] },
      ],
    });
    const runtime = new DryRunRuntime({ fixtures: {
      "reviews/action-plan.json": JSON.stringify({
        version: 1, findings: [{ id: "scope", severity: "critical", summary: "The requested venue and anonymity rules conflict." }],
        actions: [{ id: "ask-operator", tool: "request_operator_clarification", finding_ids: ["scope"], rationale: "Choose the publication target before continuing." }],
      }),
    } });
    const state = await runFlow({ workflow: clarification, workspaceDir: ws, runtime });
    expect(state.status).toBe("paused_for_approval");
    expect(state.units["dispatch.request_operator_clarification[ask-operator]"].status).toBe("succeeded");
    expect(state.pendingApprovals[0]?.kind).toBe("human");
    expect(state.pendingApprovals[0]?.stageId).toBe("dispatch");
    await fs.access(path.join(ws, "reviews", "clarification-request.md"));
  });
});
