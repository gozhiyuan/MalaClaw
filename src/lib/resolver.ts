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
  LockedProject,
  AgentDef,
  TeamDef,
  SkillEntry,
} from "./schema.js";
import { resolveProjectMeta, type ResolvedProjectMeta } from "./project-meta.js";

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
  targets?: {
    agents?: string[];
    teams?: string[];
  };
};

export type ResolveResult = {
  project: ResolvedProjectMeta;
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
export async function resolveManifest(
  manifest: Manifest,
  opts: { projectDir?: string } = {},
): Promise<ResolveResult> {
  const project = resolveProjectMeta(manifest.project, opts.projectDir);
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
        const agentId = resolveAgentId(project.id, teamId, agentDef.id);
        const workspaceDir = resolveAgentWorkspaceDir(project.id, teamId, agentDef.id);
        const agentDir = resolveOpenClawAgentDir(project.id, teamId, agentDef.id);
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
    skills.push({ skillDef, status, missingEnv, targets: skillRef.targets });
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
    project: buildLockedProject(project),
    packs: packs.map((p) => buildLockedPack(project.id, p)),
    skills: skills.map((s) => buildLockedSkill(s)),
  };

  return { project, packs, skills, lockfile };
}

function buildLockedProject(project: ResolvedProjectMeta): LockedProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    starter: project.starter,
    entry_team: project.entryTeam,
    project_dir: project.projectDir,
  };
}

function buildLockedPack(projectId: string, resolved: ResolvedPack): LockedPack {
  return {
    type: "pack",
    id: `${projectId}__${resolved.packId}__${resolved.teamDef.id}`,
    project_id: projectId,
    source_id: resolved.packId,
    team_id: resolved.teamDef.id,
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
