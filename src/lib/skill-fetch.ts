import fs from "node:fs/promises";
import path from "node:path";
import type { SkillEntry } from "./schema.js";
import { resolveStoreRoot } from "./paths.js";

export type SkillInstallResult = {
  skillId: string;
  status: "installed" | "skipped" | "failed";
  reason?: string;
  targetDir: string;
};

/**
 * Install a skill into the shared cache first, then link it into one or more workspaces.
 * For local skills: canonicalize into ~/.openclaw-store/cache/skills/<id>@<version>/.
 * For openclaw-bundled: resolve from ~/.openclaw/skills/<id> or ~/.openclaw/workspace/skills/<id>.
 * For clawhub/community sources: Phase 1 resolves from pre-fetched cache only.
 */
export async function installSkillToWorkspaces(
  skill: SkillEntry,
  workspaceDirs: string[],
  status: "active" | "inactive",
): Promise<SkillInstallResult[]> {
  if (status === "inactive") {
    return workspaceDirs.map((dir) => ({
      skillId: skill.id,
      status: "skipped" as const,
      reason: "inactive — missing required env vars",
      targetDir: path.join(dir, "skills", skill.id),
    }));
  }

  const source = await resolveSkillSource(skill);
  if (!source) {
    return workspaceDirs.map((dir) => ({
      skillId: skill.id,
      status: "failed" as const,
      reason: `Skill source not found. ${skill.install_hints?.[0] ?? ""}`.trim(),
      targetDir: path.join(dir, "skills", skill.id),
    }));
  }

  const cacheDir = resolveCanonicalSkillCacheDir(skill);
  await materializeSkillCache(source, cacheDir);

  const results: SkillInstallResult[] = [];
  for (const workspaceDir of workspaceDirs) {
    const targetDir = path.join(workspaceDir, "skills", skill.id);
    try {
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.symlink(cacheDir, targetDir, "dir");
      results.push({ skillId: skill.id, status: "installed", targetDir });
    } catch (err) {
      try {
        await fs.cp(cacheDir, targetDir, { recursive: true });
        results.push({
          skillId: skill.id,
          status: "installed",
          reason: "copied fallback (symlink unavailable)",
          targetDir,
        });
      } catch (copyErr) {
        results.push({
          skillId: skill.id,
          status: "failed",
          reason: copyErr instanceof Error ? copyErr.message : String(copyErr),
          targetDir,
        });
      }
    }
  }
  return results;
}

async function resolveSkillSource(skill: SkillEntry): Promise<string | null> {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const versionedCacheDir = resolveCanonicalSkillCacheDir(skill);

  if (skill.source.type === "local" && skill.source.url) {
    const src = skill.source.url.startsWith("~")
      ? path.join(home, skill.source.url.slice(1))
      : skill.source.url;
    if (await pathExists(src)) return src;
    return null;
  }

  // openclaw-bundled or clawhub: look in user skill cache dirs
  const candidates = [
    versionedCacheDir,
    path.join(home, ".openclaw", "workspace", "skills", skill.id),
    path.join(home, ".openclaw", "skills", skill.id),
    path.join(resolveStoreRoot(), "cache", "skills", skill.id),
  ];
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function resolveCanonicalSkillCacheDir(skill: SkillEntry): string {
  return path.join(
    resolveStoreRoot(),
    "cache",
    "skills",
    `${skill.id}@${skill.version}`,
  );
}

async function materializeSkillCache(source: string, cacheDir: string): Promise<void> {
  if (path.resolve(source) === path.resolve(cacheDir)) {
    return;
  }

  await fs.rm(cacheDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(cacheDir), { recursive: true });
  await fs.cp(source, cacheDir, { recursive: true });
}
