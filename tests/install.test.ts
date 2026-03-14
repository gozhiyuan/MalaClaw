import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { runInstall } from "../src/commands/install.js";
import { loadLockfile } from "../src/lib/loader.js";

const envKeys = [
  "OPENCLAW_STORE_DIR",
  "OPENCLAW_STATE_DIR",
  "HOME",
  "USERPROFILE",
] as const;

let tmpDir: string | null = null;
const originalEnv = new Map<string, string | undefined>();

afterEach(async () => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalEnv.clear();

  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("runInstall", () => {
  it("records failed skill installs and skips OpenClaw state writes with --no-openclaw", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-install-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.OPENCLAW_STORE_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    await runInstall({ projectDir, noOpenclaw: true });

    const lockfile = await loadLockfile(projectDir);
    expect(lockfile).not.toBeNull();
    expect(lockfile?.project?.id).toBe("project");
    expect(lockfile?.skills.find((skill) => skill.id === "github")?.status).toBe("failed");
    expect(lockfile?.skills.find((skill) => skill.id === "github")?.install_error).toMatch(
      /Skill source not found/,
    );
    const runtime = JSON.parse(await fs.readFile(path.join(storeDir, "runtime.json"), "utf-8"));
    expect(runtime.projects).toHaveLength(1);
    expect(runtime.projects[0].id).toBe("project");
    expect(runtime.projects[0].entry_points[0].openclaw_agent_id).toBe("store__project__dev-company__pm");
    await expect(fs.access(path.join(stateDir, "agents"))).rejects.toThrow();
  });

  it("installs targeted project skills into the requested agents", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-install-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "openclaw-store.yaml"),
      stringify({
        version: 1,
        project: { id: "project", name: "Project" },
        packs: [{ id: "dev-company" }],
        skills: [{
          id: "openclaw-store-manager",
          targets: { agents: ["pm"] },
        }],
      }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.OPENCLAW_STORE_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    await runInstall({ projectDir, noOpenclaw: true });

    await expect(
      fs.access(path.join(storeDir, "workspaces", "store", "project", "dev-company", "pm", "skills", "openclaw-store-manager")),
    ).resolves.not.toThrow();
    await expect(
      fs.access(path.join(storeDir, "workspaces", "store", "project", "dev-company", "backend-dev", "skills", "openclaw-store-manager")),
    ).rejects.toThrow();
  });
});
