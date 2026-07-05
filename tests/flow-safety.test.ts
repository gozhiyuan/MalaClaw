import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StandardStage, WorkflowStep, ForeachStage, WorkflowDef } from "../src/lib/schema.js";
import { expandForeachItems } from "../src/lib/workflow/foreach.js";
import { resolveWithin, isSafeWorkspacePath } from "../src/lib/workflow/safe-paths.js";

const tempDirs: string[] = [];
async function makeWorkspace(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-safe-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, rel), content, "utf-8");
  }
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe("id safety (ids become filenames)", () => {
  it("rejects ids with path separators or traversal", () => {
    expect(() => StandardStage.parse({ id: "../evil", owner: "a" })).toThrow();
    expect(() => StandardStage.parse({ id: "a/b", owner: "a" })).toThrow();
    expect(() => WorkflowStep.parse({ id: "..", owner: "a" })).toThrow();
    expect(() =>
      ForeachStage.parse({
        type: "foreach", id: "x/../y", foreach: "outline.sections",
        steps: [{ id: "draft", owner: "a" }],
      }),
    ).toThrow();
  });

  it("accepts normal ids", () => {
    expect(StandardStage.parse({ id: "draft_sections", owner: "a" }).id).toBe("draft_sections");
    expect(StandardStage.parse({ id: "review-round-2", owner: "a" }).id).toBe("review-round-2");
  });
});

describe("artifact path safety (paths are joined with the workspace dir)", () => {
  it("rejects absolute and traversal paths in outputs/inputs/external_inputs", () => {
    expect(() =>
      StandardStage.parse({ id: "x", owner: "a", outputs: ["/etc/passwd"] }),
    ).toThrow();
    expect(() =>
      StandardStage.parse({ id: "x", owner: "a", outputs: ["../outside.md"] }),
    ).toThrow();
    expect(() =>
      StandardStage.parse({ id: "x", owner: "a", inputs: ["a/../../outside.md"] }),
    ).toThrow();
    expect(() =>
      WorkflowDef.parse({
        external_inputs: ["../secrets.txt"],
        stages: [{ id: "x", owner: "a" }],
      }),
    ).toThrow();
  });

  it("accepts nested paths, globs, and templates", () => {
    const stage = StandardStage.parse({
      id: "x", owner: "a",
      outputs: ["chapters/{{section.id}}.md", "chapters/*.md", "sources/raw.jsonl"],
    });
    expect(stage.outputs).toHaveLength(3);
  });
});

describe("foreach item id safety (items come from worker-produced artifacts)", () => {
  const stage = ForeachStage.parse({
    type: "foreach", id: "sections", foreach: "outline.sections",
    steps: [{ id: "draft", owner: "a" }],
  });

  it("rejects item ids containing path separators or traversal", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "../../etc/cron.d/x" }] }),
    });
    await expect(expandForeachItems(stage, ws)).rejects.toThrow(/id/);
  });

  it("accepts normal item ids", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "section-1.2" }] }),
    });
    expect(await expandForeachItems(stage, ws)).toEqual(["section-1.2"]);
  });
});

describe("resolveWithin", () => {
  it("resolves nested paths inside the base", () => {
    expect(resolveWithin("/tmp/ws", "chapters/one.md")).toBe(path.resolve("/tmp/ws/chapters/one.md"));
  });

  it("throws when the path escapes the base", () => {
    expect(() => resolveWithin("/tmp/ws", "../outside.md")).toThrow(/escapes/);
    expect(() => resolveWithin("/tmp/ws", "/etc/passwd")).toThrow(/escapes/);
  });
});

describe("isSafeWorkspacePath", () => {
  it("classifies paths correctly", () => {
    expect(isSafeWorkspacePath("chapters/{{s.id}}.md")).toBe(true);
    expect(isSafeWorkspacePath("a/b/c.md")).toBe(true);
    expect(isSafeWorkspacePath("/abs")).toBe(false);
    expect(isSafeWorkspacePath("C:\\win")).toBe(false);
    expect(isSafeWorkspacePath("a/../../b")).toBe(false);
    expect(isSafeWorkspacePath("")).toBe(false);
  });
});
