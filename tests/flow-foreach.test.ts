import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ForeachStage, WorkflowDef } from "../src/lib/schema.js";
import { resolveItemTemplates, expandForeachItems } from "../src/lib/workflow/foreach.js";
import { approveAllFlow, runFlow } from "../src/lib/workflow/engine.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { readEvents } from "../src/lib/workflow/state.js";

const tempDirs: string[] = [];
async function makeWorkspace(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-fe-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf-8");
  }
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe("resolveItemTemplates", () => {
  it("substitutes the declared item_name and the generic item", () => {
    expect(resolveItemTemplates("chapters/{{section.id}}.md", "section", "s1"))
      .toBe("chapters/s1.md");
    expect(resolveItemTemplates("chapters/{{item.id}}.md", "section", "s1"))
      .toBe("chapters/s1.md");
  });

  it("leaves unrelated templates untouched", () => {
    expect(resolveItemTemplates("x/{{other.id}}.md", "section", "s1"))
      .toBe("x/{{other.id}}.md");
  });
});

describe("expandForeachItems", () => {
  const stage = ForeachStage.parse({
    type: "foreach",
    id: "draft_sections",
    foreach: "outline.sections",
    steps: [{ id: "draft", owner: "pm" }],
  });

  it("reads item ids from the artifact key", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "s1" }, { id: "s2" }] }),
    });
    expect(await expandForeachItems(stage, ws)).toEqual(["s1", "s2"]);
  });

  it("throws a pointed error when the artifact is missing", async () => {
    const ws = await makeWorkspace();
    await expect(expandForeachItems(stage, ws)).rejects.toThrow(/outline\.json/);
  });

  it("throws when the key is missing or malformed", async () => {
    const ws = await makeWorkspace({ "outline.json": JSON.stringify({ sections: [{ name: "no-id" }] }) });
    await expect(expandForeachItems(stage, ws)).rejects.toThrow(/id/);
    const ws2 = await makeWorkspace({ "outline.json": JSON.stringify({ other: [] }) });
    await expect(expandForeachItems(stage, ws2)).rejects.toThrow(/sections/);
  });
});

describe("foreach flow execution", () => {
  it("runs item pipelines and resolves concrete output paths", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "s1" }, { id: "s2" }] }),
    });
    const wf = WorkflowDef.parse({
      max_parallel: 2,
      stages: [{
        type: "foreach",
        id: "draft_sections",
        foreach: "outline.sections",
        item_name: "section",
        max_parallel: 2,
        steps: [
          {
            id: "draft",
            owner: "writer",
            outputs: ["chapters/{{section.id}}.md"],
            validators: ["required_output_exists"],
          },
          {
            id: "review",
            owner: "reviewer",
            inputs: ["chapters/{{section.id}}.md"],
            outputs: ["reviews/{{section.id}}.md"],
          },
        ],
      }],
    });

    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("completed");
    expect(state.foreachItems.draft_sections).toEqual(["s1", "s2"]);
    expect(state.units["draft_sections.draft[s1]"].status).toBe("succeeded");
    expect(state.units["draft_sections.review[s2]"].status).toBe("succeeded");
    await fs.access(path.join(ws, "chapters/s1.md"));
    await fs.access(path.join(ws, "reviews/s2.md"));
  });

  it("queues step review items and resumes after batch approval", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "s1" }, { id: "s2" }] }),
    });
    const wf = WorkflowDef.parse({
      max_parallel: 2,
      stages: [{
        type: "foreach",
        id: "draft_sections",
        foreach: "outline.sections",
        item_name: "section",
        max_parallel: 2,
        steps: [
          {
            id: "draft",
            owner: "writer",
            outputs: ["chapters/{{section.id}}.md"],
            requires_human_approval: true,
          },
          {
            id: "review",
            owner: "reviewer",
            inputs: ["chapters/{{section.id}}.md"],
            outputs: ["reviews/{{section.id}}.md"],
          },
        ],
      }],
    });

    const paused = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(paused.status).toBe("paused_for_approval");
    expect(paused.pendingApprovals).toHaveLength(2);
    expect(paused.pendingApprovals[0].stepId).toBe("draft");
    expect(paused.pendingApprovals[0].itemId).toBeTruthy();
    expect(paused.units["draft_sections.review[s1]"].status).toBe("pending");

    await approveAllFlow(ws);
    const resumed = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(resumed.status).toBe("completed");
    expect(resumed.pendingApprovals).toEqual([]);
    expect(resumed.units["draft_sections.review[s1]"].status).toBe("succeeded");
    expect(resumed.units["draft_sections.review[s2]"].status).toBe("succeeded");
  });

  it("persists expansion and does not reread a changed foreach artifact on resume", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "s1" }, { id: "s2" }] }),
    });
    const wf = WorkflowDef.parse({
      stages: [{
        type: "foreach",
        id: "draft_sections",
        foreach: "outline.sections",
        steps: [{ id: "draft", owner: "writer", outputs: ["chapters/{{item.id}}.md"], requires_human_approval: true }],
      }],
    });

    const paused = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(paused.foreachItems.draft_sections).toEqual(["s1", "s2"]);
    await fs.writeFile(path.join(ws, "outline.json"), JSON.stringify({ sections: [{ id: "s3" }] }), "utf-8");
    await approveAllFlow(ws);
    const resumed = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(resumed.foreachItems.draft_sections).toEqual(["s1", "s2"]);
    expect(resumed.units["draft_sections.draft[s3]"]).toBeUndefined();
  });

  it("stops only failed items immediately, lets sibling items finish, then fails the stage", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "s1" }, { id: "s2" }] }),
    });
    const wf = WorkflowDef.parse({
      max_parallel: 2,
      stages: [{
        type: "foreach",
        id: "draft_sections",
        foreach: "outline.sections",
        max_parallel: 2,
        steps: [
          { id: "draft", owner: "writer", outputs: ["chapters/{{item.id}}.md"] },
          { id: "review", owner: "reviewer", outputs: ["reviews/{{item.id}}.md"] },
        ],
      }],
    });
    const runtime = new DryRunRuntime({ outcomes: { "draft_sections.review[s1]": ["worker_error", "worker_error"] } });
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime });
    expect(state.status).toBe("failed");
    expect(state.units["draft_sections.review[s1]"].status).toBe("failed");
    expect(state.units["draft_sections.review[s2]"].status).toBe("succeeded");
  });

  it("emits a foreach expansion event", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "s1" }] }),
    });
    const wf = WorkflowDef.parse({
      stages: [{
        type: "foreach",
        id: "draft_sections",
        foreach: "outline.sections",
        steps: [{ id: "draft", owner: "writer", outputs: ["chapters/{{item.id}}.md"] }],
      }],
    });
    await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const events = await readEvents(ws);
    expect(events.some((e) => e.type === "foreach_expanded" && e.key === "draft_sections")).toBe(true);
  });
});
