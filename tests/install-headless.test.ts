import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { runHeadlessInstall, type InstallProgress } from "../src/lib/install-headless.js";

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

describe("runHeadlessInstall", () => {
  it("exists and is a function", () => {
    expect(typeof runHeadlessInstall).toBe("function");
  });

  it("returns expected shape in dryRun mode", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-headless-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({ agents: { list: [] } }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.OPENCLAW_STORE_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    const result = await runHeadlessInstall({ projectDir, dryRun: true });

    expect(result).toMatchObject({
      success: true,
      projectId: expect.any(String),
      packsInstalled: expect.any(Array),
      skillStatuses: expect.any(Array),
      errors: expect.any(Array),
    });
    expect(result.packsInstalled).toContain("dev-company");
    expect(result.errors).toHaveLength(0);
  });

  it("calls onProgress with phases during a real install", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-headless-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({ agents: { list: [] } }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.OPENCLAW_STORE_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    const progressEvents: InstallProgress[] = [];
    const result = await runHeadlessInstall({
      projectDir,
      onProgress: (p) => progressEvents.push(p),
    });

    expect(result.success).toBe(true);

    const phases = progressEvents.map((p) => p.phase);
    expect(phases).toContain("resolving");
    expect(phases).toContain("installing");
    expect(phases).toContain("finalizing");

    // Every progress event must have a non-empty message
    for (const p of progressEvents) {
      expect(typeof p.message).toBe("string");
      expect(p.message.length).toBeGreaterThan(0);
    }
  });

  it("returns InstallResult with correct projectId", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-headless-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "openclaw-store.yaml"),
      stringify({
        version: 1,
        project: { id: "my-project" },
        packs: [{ id: "dev-company" }],
        skills: [],
      }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({ agents: { list: [] } }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.OPENCLAW_STORE_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    const result = await runHeadlessInstall({ projectDir, dryRun: true });

    expect(result.projectId).toBe("my-project");
    expect(result.success).toBe(true);
  });

  it("records failed skill installs in errors array", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-headless-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "openclaw-store.yaml"),
      stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({ agents: { list: [] } }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.OPENCLAW_STORE_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    const result = await runHeadlessInstall({ projectDir });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe("project");
    // The github skill should be failed (no source)
    const githubSkill = result.skillStatuses.find((s) => s.id === "github");
    expect(githubSkill?.status).toBe("failed");
  });
});
