import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow, approveFlow } from "../src/lib/workflow/engine.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { readEvents } from "../src/lib/workflow/state.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-budget-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

const tieredWorkflow = () => WorkflowDef.parse({
  model_tiers: {
    cheap: { runtime: "dry-run", model: "small" },
    strong: { runtime: "dry-run", model: "big", requires_budget_approval: true },
  },
  stages: [
    { id: "outline", owner: "pm", outputs: ["outline.md"], model_tier: "cheap" },
    { id: "draft", owner: "writer", outputs: ["draft.md"], model_tier: "strong" },
    { id: "publish", owner: "pm", outputs: ["final.md"] },
  ],
});

describe("budget approval gate", () => {
  it("pauses before running a stage on a requires_budget_approval tier", async () => {
    const ws = await makeWorkspace();
    const state = await runFlow({ workflow: tieredWorkflow(), workspaceDir: ws, runtime: new DryRunRuntime() });

    expect(state.status).toBe("paused_for_approval");
    expect(state.units.outline.status).toBe("succeeded");
    // The gated stage must not have consumed any attempts or produced output.
    expect(state.units.draft.status).toBe("pending");
    expect(state.units.draft.attempts).toBe(0);
    await expect(fs.access(path.join(ws, "draft.md"))).rejects.toThrow();

    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.pendingApprovals[0].id).toBe("approve-budget-draft-001");

    const events = await readEvents(ws);
    expect(events.some((e) => e.type === "flow_paused_budget_approval" && e.key === "draft")).toBe(true);
  });

  it("resumes through the gate after approval and completes", async () => {
    const ws = await makeWorkspace();
    const workflow = tieredWorkflow();
    await runFlow({ workflow, workspaceDir: ws, runtime: new DryRunRuntime() });
    await approveFlow(ws, "approve-budget-draft-001");

    const state = await runFlow({ workflow, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("completed");
    expect(state.units.draft.status).toBe("succeeded");
    await expect(fs.readFile(path.join(ws, "draft.md"), "utf-8")).resolves.toContain("dry-run");
    // Approval must not be re-queued once granted.
    expect(state.pendingApprovals).toHaveLength(0);
  });

  it("gates foreach stages when any step uses a budget tier", async () => {
    const ws = await makeWorkspace();
    const workflow = WorkflowDef.parse({
      model_tiers: {
        strong: { runtime: "dry-run", model: "big", requires_budget_approval: true },
      },
      stages: [
        { id: "outline", owner: "pm", outputs: ["outline.json"] },
        {
          id: "sections",
          type: "foreach",
          foreach: "outline.sections",
          item_name: "section",
          steps: [
            {
              id: "write", owner: "writer", model_tier: "strong",
              outputs: ["chapters/{{section.id}}.md"],
            },
          ],
        },
      ],
    });
    const state = await runFlow({ workflow, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("paused_for_approval");
    expect(state.pendingApprovals[0].id).toBe("approve-budget-sections-001");

    await approveFlow(ws, "approve-budget-sections-001");
    const finished = await runFlow({ workflow, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(finished.status).toBe("completed");
  });

  it("does not gate tiers without requires_budget_approval", async () => {
    const ws = await makeWorkspace();
    const workflow = WorkflowDef.parse({
      model_tiers: { cheap: { runtime: "dry-run", model: "small" } },
      stages: [{ id: "outline", owner: "pm", outputs: ["outline.md"], model_tier: "cheap" }],
    });
    const state = await runFlow({ workflow, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("completed");
  });
});
