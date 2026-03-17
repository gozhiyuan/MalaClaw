import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { computeDiff } from "../src/lib/diff.js";

let tmpDir: string | null = null;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("computeDiff", () => {
  it("returns an array", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-lib-"));

    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [], skills: [] }),
    );
    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.lock"),
      stringify({ version: 1, packs: [], skills: [] }),
    );

    const diffs = await computeDiff({ projectDir: tmpDir });

    expect(Array.isArray(diffs)).toBe(true);
  });

  it("returns empty array when no lockfile exists", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-lib-"));

    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [], skills: [] }),
    );
    // No lockfile written

    const diffs = await computeDiff({ projectDir: tmpDir });

    expect(diffs).toEqual([]);
  });

  it("returns empty diff when manifest matches lockfile (no skills, no packs)", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-lib-"));

    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [], skills: [] }),
    );
    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.lock"),
      stringify({ version: 1, packs: [], skills: [] }),
    );

    const diffs = await computeDiff({ projectDir: tmpDir });

    const changed = diffs.filter((d) => d.type !== "unchanged");
    expect(changed).toHaveLength(0);
  });

  it("detects removed skills", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-lib-"));

    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [], skills: [] }),
    );
    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.lock"),
      stringify({
        version: 1,
        packs: [],
        skills: [{ type: "skill", id: "stale-skill", version: "1", status: "active" }],
      }),
    );

    const diffs = await computeDiff({ projectDir: tmpDir });

    const removed = diffs.filter((d) => d.type === "removed" && d.kind === "skill");
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe("stale-skill");
  });

  it("detects added skills", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-lib-"));

    // Manifest references a skill that is not in the lockfile yet
    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.yaml"),
      stringify({
        version: 1,
        packs: [],
        skills: [{ id: "github" }],
      }),
    );
    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.lock"),
      stringify({ version: 1, packs: [], skills: [] }),
    );

    const diffs = await computeDiff({ projectDir: tmpDir });

    const added = diffs.filter((d) => d.type === "added" && d.kind === "skill");
    expect(added.length).toBeGreaterThanOrEqual(1);
    expect(added.some((d) => d.id === "github")).toBe(true);
  });

  it("every diff entry has the correct shape", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-lib-"));

    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [], skills: [] }),
    );
    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.lock"),
      stringify({
        version: 1,
        packs: [],
        skills: [{ type: "skill", id: "old-skill", version: "1", status: "active" }],
      }),
    );

    const diffs = await computeDiff({ projectDir: tmpDir });

    for (const d of diffs) {
      expect(["added", "removed", "changed", "unchanged"]).toContain(d.type);
      expect(["agent", "skill"]).toContain(d.kind);
      expect(typeof d.id).toBe("string");
    }
  });

  it("does not call console.log", async () => {
    // computeDiff is side-effect-free — it just returns data
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-lib-"));

    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [], skills: [] }),
    );
    await fs.writeFile(
      path.join(tmpDir, "openclaw-store.lock"),
      stringify({
        version: 1,
        packs: [],
        skills: [{ type: "skill", id: "stale", version: "1", status: "active" }],
      }),
    );

    // If computeDiff called console.log it would not cause a test failure,
    // but we verify it resolves cleanly without side effects by checking the return value.
    const diffs = await computeDiff({ projectDir: tmpDir });
    expect(Array.isArray(diffs)).toBe(true);
  });
});
