import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { runDiff } from "../src/commands/diff.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDiff", () => {
  it("runs without error when lockfile exists", async () => {
    const origCwd = process.cwd();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-"));
    process.chdir(tmpDir);
    try {
      await fs.writeFile(
        path.join(tmpDir, "openclaw-store.yaml"),
        stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
      );
      // Should not throw even without lockfile
      await expect(runDiff(tmpDir)).resolves.not.toThrow();
    } finally {
      process.chdir(origCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports skills removed from the manifest", async () => {
    const origCwd = process.cwd();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.chdir(tmpDir);
    try {
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

      await runDiff(tmpDir);

      const output = logSpy.mock.calls.flat().join("\n");
      expect(output).toContain("- Removed:");
      expect(output).toContain("[skill] stale-skill");
    } finally {
      process.chdir(origCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
