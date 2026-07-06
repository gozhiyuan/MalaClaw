import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runRuntimeSmoke } from "../src/lib/workflow/runtime-smoke.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe("runtime smoke helper", () => {
  it("runs a one-stage smoke workflow and writes a report", async () => {
    const workspace = await makeTempDir("malaclaw-smoke-ws-");
    const reportDir = await makeTempDir("malaclaw-smoke-reports-");

    const result = await runRuntimeSmoke({
      runtime: "dry-run",
      workspaceDir: workspace,
      reportDir,
      keepWorkspace: true,
    });

    expect(result.health.available).toBe(true);
    expect(result.state?.status).toBe("completed");
    expect(result.artifactExists).toBe(true);
    expect(await fs.readFile(path.join(workspace, "smoke.md"), "utf-8")).toContain("dry-run artifact");
    const report = await fs.readFile(result.reportPath, "utf-8");
    expect(report).toContain("MalaClaw Runtime Smoke");
    expect(report).toContain("Runtime: dry-run");
    expect(report).toContain("Flow status: completed");
    expect(report).toContain("Artifact smoke.md: present");
  });
});
