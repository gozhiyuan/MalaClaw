import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow } from "../src/lib/workflow/engine.js";
import { renderOperatorBrief } from "../src/lib/workflow/operator-brief.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("operator brief", () => {
  it("reports a blocker without suggesting an unsafe approval", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-brief-"));
    roots.push(workspace);
    const workflow = WorkflowDef.parse({ stages: [{ id: "write", owner: "writer", outputs: ["draft.md"] }] });
    await runFlow({ workflow, workspaceDir: workspace, runtime: new DryRunRuntime({ outcomes: { write: ["quota_exhausted"] } }) });
    const brief = await renderOperatorBrief(workspace);
    expect(brief).toContain("Status: **paused_blocker**");
    expect(brief).toContain("malaclaw flow supervise");
    expect(brief).not.toContain("approve <id>");
  });
});
