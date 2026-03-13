import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { runDiff } from "../src/commands/diff.js";

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
});
