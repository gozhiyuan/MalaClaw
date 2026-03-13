import { loadPack, loadTeam, loadAgent, loadSkill } from "./loader.js";
import {
  resolveAgentWorkspaceDir,
  resolveOpenClawAgentDir,
  resolveAgentId,
} from "./paths.js";
import type {
  Manifest,
  Lockfile,
  LockedPack,
  LockedSkill,
  AgentDef,
  TeamDef,
  SkillEntry,
} from "./schema.js";

export type ResolvedAgent = {
  agentDef: AgentDef;
  teamDef: TeamDef;
  agentId: string;
  workspaceDir: string;
  agentDir: string;
};

export type ResolvedPack = {
  packId: string;
  version: string;
  teamDef: TeamDef;
  agents: ResolvedAgent[];
};

export type ResolvedSkill = {
  skillDef: SkillEntry;
  status: "active" | "inactive";
  missingEnv: string[];
};

export type ResolveResult = {
  packs: ResolvedPack[];
  skills: ResolvedSkill[];
  lockfile: Lockfile;
};

/** Check which env vars are missing for a skill */
function checkSkillEnv(skill: SkillEntry): { status: "active" | "inactive"; missingEnv: string[] } {
  const required = skill.requires?.env?.filter((e) => e.required) ?? [];
  const missing = required
    .filter((e) => !process.env[e.key])
    .map((e) => e.key);

  if (missing.length > 0 && skill.disabled_until_configured) {
    return { status: "inactive", missingEnv: missing };
  }
  return { status: "active", missingEnv: missing };
}

/** Resolve the full manifest into a concrete install plan */
export async function resolveManifest(manifest: Manifest): Promise<ResolveResult> {
  const packs: ResolvedPack[] = [];
  const skills: ResolvedSkill[] = [];

  // Resolve packs
  for (const packRef of manifest.packs ?? []) {
    const packDef = await loadPack(packRef.id);

    // Support multi-team packs: resolve each team separately
    for (const teamId of packDef.teams) {
      const teamDef = await loadTeam(teamId);

      const resolvedAgents: ResolvedAgent[] = [];
      for (const member of teamDef.members) {
        const agentDef = await loadAgent(member.agent);
        const agentId = resolveAgentId(teamId, agentDef.id);
        const workspaceDir = resolveAgentWorkspaceDir(teamId, agentDef.id);
        const agentDir = resolveOpenClawAgentDir(teamId, agentDef.id);
        resolvedAgents.push({ agentDef, teamDef, agentId, workspaceDir, agentDir });
      }

      packs.push({
        packId: packRef.id,
        version: packDef.version,
        teamDef,
        agents: resolvedAgents,
      });
    }
  }

  // Resolve skills
  for (const skillRef of manifest.skills ?? []) {
    const skillDef = await loadSkill(skillRef.id);
    const { status, missingEnv } = checkSkillEnv(skillDef);
    skills.push({ skillDef, status, missingEnv });
  }

  // Also include default skills from packs
  const packSkillIds = new Set<string>();
  for (const pack of packs) {
    const packDef = await loadPack(pack.packId);
    for (const sid of packDef.default_skills ?? []) {
      if (!packSkillIds.has(sid)) {
        packSkillIds.add(sid);
        // Only add if not already in manifest skills
        const alreadyIncluded = (manifest.skills ?? []).some((s) => s.id === sid);
        if (!alreadyIncluded) {
          try {
            const skillDef = await loadSkill(sid);
            const { status, missingEnv } = checkSkillEnv(skillDef);
            skills.push({ skillDef, status, missingEnv });
          } catch {
            // Skill template not found — skip silently
          }
        }
      }
    }
  }

  // Build lockfile
  const lockfile: Lockfile = {
    version: 1,
    generated_at: new Date().toISOString(),
    packs: packs.map((p) => buildLockedPack(p)),
    skills: skills.map((s) => buildLockedSkill(s)),
  };

  return { packs, skills, lockfile };
}

function buildLockedPack(resolved: ResolvedPack): LockedPack {
  return {
    type: "pack",
    id: `${resolved.packId}__${resolved.teamDef.id}`,  // unique per team
    version: resolved.version,
    agents: resolved.agents.map((a) => ({
      id: a.agentId,
      workspace: a.workspaceDir,
      agent_dir: a.agentDir,
    })),
  };
}

function buildLockedSkill(resolved: ResolvedSkill): LockedSkill {
  return {
    type: "skill",
    id: resolved.skillDef.id,
    version: String(resolved.skillDef.version),
    status: resolved.status,
    missing_env: resolved.missingEnv.length > 0 ? resolved.missingEnv : undefined,
  };
}
