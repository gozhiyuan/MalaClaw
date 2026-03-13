import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installSkillToWorkspaces } from "../src/lib/skill-fetch.js";
import { SkillEntry } from "../src/lib/schema.js";

let tmpDir: string;
let originalStoreDir: string | undefined;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-skill-"));
  originalStoreDir = process.env.OPENCLAW_STORE_DIR;
  originalHome = process.env.HOME;
  process.env.OPENCLAW_STORE_DIR = path.join(tmpDir, "store");
  process.env.HOME = path.join(tmpDir, "home");
});

afterEach(async () => {
  if (originalStoreDir === undefined) {
    delete process.env.OPENCLAW_STORE_DIR;
  } else {
    process.env.OPENCLAW_STORE_DIR = originalStoreDir;
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const makeLocalSkill = (skillDir: string): SkillEntry =>
  SkillEntry.parse({
    id: "test-skill",
    version: 1,
    name: "Test Skill",
    source: { type: "local", url: skillDir },
    trust_tier: "local",
    disabled_until_configured: false,
  });

const makeCachedSkill = (): SkillEntry =>
  SkillEntry.parse({
    id: "test-skill",
    version: 1,
    name: "Test Skill",
    source: { type: "clawhub", url: "https://example.com/test-skill" },
    trust_tier: "community",
    disabled_until_configured: false,
  });

describe("installSkillToWorkspaces", () => {
  it("installs local skill into cache and exposes it in workspace skills directory", async () => {
    // Set up a fake skill source
    const skillSrc = path.join(tmpDir, "skill-src");
    await fs.mkdir(skillSrc);
    await fs.writeFile(path.join(skillSrc, "SKILL.md"), "# Test Skill\n");

    const workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir);

    const results = await installSkillToWorkspaces(makeLocalSkill(skillSrc), [workspaceDir], "active");
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("installed");

    const installedFile = path.join(workspaceDir, "skills", "test-skill", "SKILL.md");
    const content = await fs.readFile(installedFile, "utf-8");
    expect(content).toContain("Test Skill");
  });

  it("skips installation when skill is inactive", async () => {
    const workspaceDir = path.join(tmpDir, "workspace");
    const results = await installSkillToWorkspaces(makeLocalSkill("/nonexistent"), [workspaceDir], "inactive");
    expect(results[0].status).toBe("skipped");
  });

  it("returns failed when skill source not found", async () => {
    const workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir);
    const results = await installSkillToWorkspaces(makeLocalSkill("/does/not/exist"), [workspaceDir], "active");
    expect(results[0].status).toBe("failed");
  });

  it("reuses the canonical versioned cache for prefetched community skills", async () => {
    const cacheDir = path.join(tmpDir, "store", "cache", "skills", "test-skill@1");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "SKILL.md"), "# Cached Test Skill\n");

    const workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir);

    const results = await installSkillToWorkspaces(makeCachedSkill(), [workspaceDir], "active");
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("installed");

    const installedFile = path.join(workspaceDir, "skills", "test-skill", "SKILL.md");
    await expect(fs.readFile(installedFile, "utf-8")).resolves.toContain("Cached Test Skill");
  });
});
