import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AgentDef,
  TeamDef,
  SkillEntry,
  PackDef,
  Manifest,
  Lockfile,
} from "./schema.js";
import {
  resolveAgentTemplatesDir,
  resolveTeamTemplatesDir,
  resolveSkillTemplatesDir,
  resolvePacksDir,
  resolveManifestPath,
  resolveLockfilePath,
  resolveOverlayTemplatesDir,
} from "./paths.js";

async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return parseYaml(raw) as T;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── Agent templates ──────────────────────────────────────────────────────────

export async function loadAgent(agentId: string): Promise<AgentDef> {
  const overlay = resolveOverlayTemplatesDir();
  if (overlay) {
    const overlayPath = path.join(overlay, "agents", `${agentId}.yaml`);
    if (await fileExists(overlayPath)) {
      const raw = await readYaml<unknown>(overlayPath);
      return AgentDef.parse(raw);
    }
  }
  const filePath = path.join(resolveAgentTemplatesDir(), `${agentId}.yaml`);
  const raw = await readYaml<unknown>(filePath);
  return AgentDef.parse(raw);
}

export async function listAgentIds(): Promise<string[]> {
  const dir = resolveAgentTemplatesDir();
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => e.endsWith(".yaml"))
      .map((e) => e.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}

export async function loadAllAgents(): Promise<AgentDef[]> {
  const ids = await listAgentIds();
  return Promise.all(ids.map(loadAgent));
}

// ── Team templates ───────────────────────────────────────────────────────────

export async function loadTeam(teamId: string): Promise<TeamDef> {
  const overlay = resolveOverlayTemplatesDir();
  if (overlay) {
    const overlayPath = path.join(overlay, "teams", `${teamId}.yaml`);
    if (await fileExists(overlayPath)) {
      const raw = await readYaml<unknown>(overlayPath);
      return TeamDef.parse(raw);
    }
  }
  const filePath = path.join(resolveTeamTemplatesDir(), `${teamId}.yaml`);
  const raw = await readYaml<unknown>(filePath);
  return TeamDef.parse(raw);
}

export async function listTeamIds(): Promise<string[]> {
  const dir = resolveTeamTemplatesDir();
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => e.endsWith(".yaml"))
      .map((e) => e.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}

export async function loadAllTeams(): Promise<TeamDef[]> {
  const ids = await listTeamIds();
  return Promise.all(ids.map(loadTeam));
}

// ── Skill templates ──────────────────────────────────────────────────────────

export async function loadSkill(skillId: string): Promise<SkillEntry> {
  const overlay = resolveOverlayTemplatesDir();
  if (overlay) {
    const overlayPath = path.join(overlay, "skills", `${skillId}.yaml`);
    if (await fileExists(overlayPath)) {
      const raw = await readYaml<unknown>(overlayPath);
      return SkillEntry.parse(raw);
    }
  }
  const filePath = path.join(resolveSkillTemplatesDir(), `${skillId}.yaml`);
  const raw = await readYaml<unknown>(filePath);
  return SkillEntry.parse(raw);
}

export async function listSkillIds(): Promise<string[]> {
  const dir = resolveSkillTemplatesDir();
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => e.endsWith(".yaml"))
      .map((e) => e.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}

export async function loadAllSkills(): Promise<SkillEntry[]> {
  const ids = await listSkillIds();
  return Promise.all(ids.map(loadSkill));
}

// ── Pack definitions ─────────────────────────────────────────────────────────

export async function loadPack(packId: string): Promise<PackDef> {
  const overlay = resolveOverlayTemplatesDir();
  if (overlay) {
    const overlayPath = path.join(overlay, "packs", `${packId}.yaml`);
    if (await fileExists(overlayPath)) {
      const raw = await readYaml<unknown>(overlayPath);
      return PackDef.parse(raw);
    }
  }
  const filePath = path.join(resolvePacksDir(), `${packId}.yaml`);
  const raw = await readYaml<unknown>(filePath);
  return PackDef.parse(raw);
}

export async function listPackIds(): Promise<string[]> {
  const dir = resolvePacksDir();
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => e.endsWith(".yaml"))
      .map((e) => e.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}

export async function loadAllPacks(): Promise<PackDef[]> {
  const ids = await listPackIds();
  return Promise.all(ids.map(loadPack));
}

// ── Project manifest & lockfile ──────────────────────────────────────────────

export async function loadManifest(projectDir?: string): Promise<Manifest> {
  const filePath = resolveManifestPath(projectDir);
  if (!(await fileExists(filePath))) {
    throw new Error(
      `No openclaw-store.yaml found in ${projectDir ?? process.cwd()}.\nRun: openclaw-store init`,
    );
  }
  const raw = await readYaml<unknown>(filePath);
  return Manifest.parse(raw);
}

export async function loadLockfile(projectDir?: string): Promise<Lockfile | null> {
  const filePath = resolveLockfilePath(projectDir);
  if (!(await fileExists(filePath))) return null;
  const raw = await readYaml<unknown>(filePath);
  return Lockfile.parse(raw);
}

export async function writeLockfile(lockfile: Lockfile, projectDir?: string): Promise<void> {
  const { stringify } = await import("yaml");
  const filePath = resolveLockfilePath(projectDir);
  await fs.writeFile(filePath, stringify(lockfile), "utf-8");
}

export async function writeManifest(manifest: Manifest, projectDir?: string): Promise<void> {
  const { stringify } = await import("yaml");
  const filePath = resolveManifestPath(projectDir);
  await fs.writeFile(filePath, stringify(manifest), "utf-8");
}
