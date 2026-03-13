import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-overlay-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("overlay loader", () => {
  it("loads agent from overlay directory when present, ignoring bundled", async () => {
    // Create an overlay agent file with different name
    const agentsDir = path.join(tmpDir, "agents");
    await fs.mkdir(agentsDir);
    await fs.writeFile(
      path.join(agentsDir, "pm.yaml"),
      `id: pm\nversion: 1\nname: "Custom PM"\nsoul:\n  persona: "Custom persona"\nmodel:\n  primary: "claude-haiku-4-5"\ncapabilities: {}\nteam_role:\n  role: lead\n`,
    );
    process.env.OPENCLAW_STORE_TEMPLATES = tmpDir;
    // Dynamically re-import to pick up env var
    const { loadAgent } = await import("../src/lib/loader.js");
    const agent = await loadAgent("pm");
    expect(agent.name).toBe("Custom PM");
    delete process.env.OPENCLAW_STORE_TEMPLATES;
  });
});
