import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import {
  initFlowState,
  loadFlowState,
  saveFlowState,
  appendEvent,
  readEvents,
  workflowHash,
  flowDir,
} from "../src/lib/workflow/state.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-flow-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

const wf = WorkflowDef.parse({
  stages: [
    { id: "plan", owner: "pm", outputs: ["plan.md"] },
    { id: "build", owner: "tech-lead", inputs: ["plan.md"], requires_human_approval: true },
  ],
});

describe("flow state", () => {
  it("initializes one pending unit per sequential stage", async () => {
    const ws = await makeWorkspace();
    const state = await initFlowState(wf, ws);
    expect(state.status).toBe("idle");
    expect(Object.keys(state.units)).toEqual(["plan", "build"]);
    expect(state.units.plan.status).toBe("pending");
    expect(state.workflowHash).toBe(workflowHash(wf));
  });

  it("round-trips through save/load", async () => {
    const ws = await makeWorkspace();
    const state = await initFlowState(wf, ws);
    state.units.plan.status = "succeeded";
    state.status = "running";
    await saveFlowState(ws, state);
    const loaded = await loadFlowState(ws);
    expect(loaded?.units.plan.status).toBe("succeeded");
    expect(loaded?.status).toBe("running");
  });

  it("returns null when no state exists", async () => {
    const ws = await makeWorkspace();
    expect(await loadFlowState(ws)).toBeNull();
  });

  it("changes hash when the workflow changes", () => {
    const wf2 = WorkflowDef.parse({ stages: [{ id: "plan", owner: "pm" }] });
    expect(workflowHash(wf)).not.toBe(workflowHash(wf2));
  });

  it("appends and reads events", async () => {
    const ws = await makeWorkspace();
    await initFlowState(wf, ws);
    await appendEvent(ws, { type: "unit_started", key: "plan" });
    await appendEvent(ws, { type: "unit_succeeded", key: "plan" });
    const events = await readEvents(ws);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("unit_started");
    expect(events[0].ts).toBeTruthy();
  });

  it("keeps state under .malaclaw/flow/", async () => {
    const ws = await makeWorkspace();
    await initFlowState(wf, ws);
    const stat = await fs.stat(path.join(flowDir(ws), "state.json"));
    expect(stat.isFile()).toBe(true);
  });
});
