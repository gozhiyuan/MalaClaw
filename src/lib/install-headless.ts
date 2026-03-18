import { loadManifest, writeLockfile } from "./loader.js";
import { resolveManifest, type ResolvedPack } from "./resolver.js";
import {
  updateStoreGuidance,
  readOpenClawConfig,
  writeOpenClawConfig,
  addSkillsToAgentAllowlists,
} from "./adapters/openclaw.js";
import { getProvisioner } from "./adapters/registry.js";
import { writeAgentTelemetry } from "./telemetry.js";
import { seedTeamSharedMemory } from "./memory.js";
import { resolveLockfilePath, resolveManifestPath, resolveStoreWorkspacesRoot } from "./paths.js";
import fs from "node:fs/promises";
import type { Lockfile, RuntimeAttachedAgent, RuntimeProject } from "./schema.js";
import { upsertRuntimeProject } from "./runtime.js";
import { resolveOpenClawAgentsById } from "./openclaw-agents.js";

export type InstallProgress = {
  phase: "resolving" | "installing" | "skills" | "finalizing";
  message: string;
  current?: number;
  total?: number;
};

export type InstallResult = {
  success: boolean;
  projectId: string;
  packsInstalled: string[];
  skillStatuses: { id: string; status: string; missingEnv?: string[] }[];
  errors: string[];
};

export type InstallOpts = {
  dryRun?: boolean;
  force?: boolean;
  pack?: string;
  projectDir?: string;
  onProgress?: (progress: InstallProgress) => void;
};

type FinalSkillState = {
  status: "active" | "inactive" | "failed";
  missingEnv: string[];
  installError?: string;
};

export function finalizeLockfileSkills(
  lockfile: Lockfile,
  finalSkillStates: Map<string, FinalSkillState>,
): Lockfile {
  return {
    ...lockfile,
    skills: lockfile.skills.map((skill) => {
      const finalState = finalSkillStates.get(skill.id);
      if (!finalState) return skill;
      return {
        ...skill,
        status: finalState.status,
        missing_env: finalState.missingEnv.length > 0 ? finalState.missingEnv : undefined,
        install_error: finalState.status === "failed" ? finalState.installError : undefined,
      };
    }),
  };
}

export function shouldInstallSkillForAgent(
  pack: ResolvedPack,
  agent: ResolvedPack["agents"][number],
  resolvedSkill: { skillDef: { id: string }; targets?: { agents?: string[]; teams?: string[] } },
): boolean {
  if (agent.agentDef.skills?.includes(resolvedSkill.skillDef.id)) {
    return true;
  }
  const targetTeams = new Set(resolvedSkill.targets?.teams ?? []);
  if (targetTeams.has(pack.teamDef.id)) {
    return true;
  }
  const targetAgents = new Set(resolvedSkill.targets?.agents ?? []);
  return targetAgents.has(agent.agentDef.id) || targetAgents.has(agent.agentId);
}

export function buildRuntimeProject(
  project: { id: string; name?: string; description?: string; starter?: string; entryTeam?: string; projectDir: string },
  packs: ResolvedPack[],
  lockfile: Lockfile,
  opts: { manifestPath?: string; lockfilePath?: string },
  attachedAgents: RuntimeAttachedAgent[] = [],
): RuntimeProject {
  const entryPoints = packs.flatMap((pack) => {
    const entryMember = pack.teamDef.members.find((m) => m.entry_point);
    if (!entryMember) return [];
    const resolvedAgent = pack.agents.find((a) => a.agentDef.id === entryMember.agent);
    if (!resolvedAgent) return [];
    return [{
      team_id: pack.teamDef.id,
      agent_id: entryMember.agent,
      openclaw_agent_id: resolvedAgent.agentId,
      agent_name: resolvedAgent.agentDef.name,
    }];
  });

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    starter: project.starter,
    entry_team: project.entryTeam,
    project_dir: project.projectDir,
    manifest_path: opts.manifestPath,
    lockfile_path: opts.lockfilePath,
    packs: (lockfile.packs ?? []).map((p) => p.id),
    skills: (lockfile.skills ?? []).map((s) => s.id),
    entry_points: entryPoints,
    attached_agents: attachedAgents,
    updated_at: new Date().toISOString(),
  };
}

export async function runHeadlessInstall(opts: InstallOpts): Promise<InstallResult> {
  const errors: string[] = [];

  let manifest: Awaited<ReturnType<typeof loadManifest>>;
  if (opts.pack) {
    manifest = { version: 1, runtime: "openclaw" as const, packs: [{ id: opts.pack }], skills: [] };
  } else {
    manifest = await loadManifest(opts.projectDir);
  }

  opts.onProgress?.({ phase: "resolving", message: "Resolving manifest..." });
  const { project, packs, skills, lockfile } = await resolveManifest(manifest, {
    projectDir: opts.projectDir,
  });

  const runtime = manifest.runtime ?? "openclaw";
  const provisioner = getProvisioner(runtime);

  if (packs.length === 0 && skills.length === 0) {
    opts.onProgress?.({ phase: "finalizing", message: "Nothing to install." });
    return {
      success: true,
      projectId: project.id,
      packsInstalled: [],
      skillStatuses: [],
      errors: [],
    };
  }

  if (opts.dryRun) {
    return {
      success: true,
      projectId: project.id,
      packsInstalled: packs.map((p) => p.packId),
      skillStatuses: skills.map((s) => ({
        id: s.skillDef.id,
        status: s.status,
        missingEnv: s.missingEnv,
      })),
      errors: [],
    };
  }

  // Ensure store workspace root exists
  await fs.mkdir(resolveStoreWorkspacesRoot(), { recursive: true });

  const finalSkillStates = new Map<string, FinalSkillState>(
    skills.map((skill) => [
      skill.skillDef.id,
      {
        status: skill.status as "active" | "inactive" | "failed",
        missingEnv: skill.missingEnv,
      },
    ]),
  );

  const attachedAgents = (await resolveOpenClawAgentsById(project.attachedAgents)).map((agent) => ({
    id: agent.id,
    name: agent.name,
    workspace: agent.workspace,
    agent_dir: agent.agentDir,
    source: "project-attached" as const,
  }));

  // workspaceDir → agentId map for allowlist patching after skills are installed
  const workspaceDirToAgentId = new Map<string, string>();

  // Install each pack
  const totalPacks = packs.length;
  for (let packIdx = 0; packIdx < packs.length; packIdx++) {
    const resolved = packs[packIdx];
    opts.onProgress?.({
      phase: "installing",
      message: `Installing pack: ${resolved.packId} (v${resolved.version})`,
      current: packIdx + 1,
      total: totalPacks,
    });

    const agentsWithMembers = resolved.agents.map((a) => {
      const member = resolved.teamDef.members.find((m) => m.agent === a.agentDef.id)!;
      workspaceDirToAgentId.set(a.workspaceDir, a.agentId);
      return {
        agentDef: a.agentDef,
        member,
        workspaceDir: a.workspaceDir,
        agentDir: a.agentDir,
      };
    });

    await provisioner.installTeam({
      projectId: project.id,
      teamDef: resolved.teamDef,
      agents: agentsWithMembers,
      overwrite: opts.force,
    });

    opts.onProgress?.({
      phase: "installing",
      message: `Seeding shared memory for ${resolved.teamDef.name ?? resolved.teamDef.id}...`,
    });
    await seedTeamSharedMemory(project.id, resolved.teamDef);

    for (const agent of resolved.agents) {
      await writeAgentTelemetry({
        agentId: agent.agentId,
        runtime,
        status: "idle",
        detail: "Provisioned by malaclaw install",
        updatedAt: new Date().toISOString(),
        workspaceDir: agent.workspaceDir,
        ttlSeconds: 300,
        source: "manual",
      });
    }
  }

  // Update main agent guidance (OpenClaw only)
  if (runtime === "openclaw") {
    opts.onProgress?.({ phase: "installing", message: "Updating main agent guidance (TOOLS.md, AGENTS.md)..." });
    await updateStoreGuidance();
  }

  // Install skills into each agent workspace that lists them
  const skillToAgentIds = new Map<string, string[]>();
  if (skills.length > 0) {
    const { installSkillToWorkspaces } = await import("./skill-fetch.js");
    const totalSkills = skills.length;
    for (let skillIdx = 0; skillIdx < skills.length; skillIdx++) {
      const resolvedSkill = skills[skillIdx];
      opts.onProgress?.({
        phase: "skills",
        message: `Installing skill: ${resolvedSkill.skillDef.id}`,
        current: skillIdx + 1,
        total: totalSkills,
      });

      const targetWorkspaces = new Set<string>();
      for (const pack of packs) {
        for (const agent of pack.agents) {
          if (shouldInstallSkillForAgent(pack, agent, resolvedSkill)) {
            targetWorkspaces.add(agent.workspaceDir);
          }
        }
      }
      for (const attachedAgent of attachedAgents) {
        if (
          attachedAgent.workspace
          && resolvedSkill.targets?.agents?.includes(attachedAgent.id)
        ) {
          targetWorkspaces.add(attachedAgent.workspace);
          workspaceDirToAgentId.set(attachedAgent.workspace, attachedAgent.id);
        }
      }
      if (targetWorkspaces.size === 0) continue;

      const results = await installSkillToWorkspaces(
        resolvedSkill.skillDef,
        [...targetWorkspaces],
        resolvedSkill.status,
      );
      const failures = results.filter((r) => r.status === "failed");
      if (failures.length > 0) {
        finalSkillStates.set(resolvedSkill.skillDef.id, {
          status: "failed",
          missingEnv: resolvedSkill.missingEnv,
          installError: failures
            .map((r) => r.reason ?? `Failed to install into ${r.targetDir}`)
            .join("; "),
        });
        errors.push(`Skill ${resolvedSkill.skillDef.id} failed: ${failures.map((r) => r.reason ?? "unknown").join("; ")}`);
      }

      const installedAgentIds: string[] = [];
      for (const r of results) {
        if (r.status === "installed") {
          const workspaceDir = r.targetDir.replace(/\/skills\/[^/]+$/, "");
          const mappedId = workspaceDirToAgentId.get(workspaceDir);
          if (mappedId) installedAgentIds.push(mappedId);
        }
      }
      if (installedAgentIds.length > 0) {
        skillToAgentIds.set(resolvedSkill.skillDef.id, installedAgentIds);
      }
    }

    // Patch agent allowlists in openclaw.json for agents with explicit skills[] keys (OpenClaw only)
    if (runtime === "openclaw" && skillToAgentIds.size > 0) {
      const { path: configPath, config } = await readOpenClawConfig();
      for (const [skillId, agentIds] of skillToAgentIds) {
        addSkillsToAgentAllowlists(config, agentIds, [skillId]);
      }
      await writeOpenClawConfig(configPath, config);
    }
  }

  const finalLockfile = finalizeLockfileSkills(lockfile, finalSkillStates);

  opts.onProgress?.({ phase: "finalizing", message: "Writing lockfile..." });

  // Write lockfile
  if (!opts.pack) {
    await writeLockfile(finalLockfile, opts.projectDir);
  }

  await upsertRuntimeProject(buildRuntimeProject(project, packs, finalLockfile, {
    manifestPath: opts.pack ? undefined : resolveManifestPath(opts.projectDir),
    lockfilePath: opts.pack ? undefined : resolveLockfilePath(opts.projectDir),
  }, attachedAgents));

  const totalAgents = packs.reduce((n, p) => n + p.agents.length, 0);
  opts.onProgress?.({
    phase: "finalizing",
    message: `Installation complete. ${totalAgents} agent(s) installed across ${packs.length} pack(s).`,
  });

  return {
    success: true,
    projectId: project.id,
    packsInstalled: packs.map((p) => p.packId),
    skillStatuses: finalLockfile.skills.map((s) => ({
      id: s.id,
      status: s.status,
      missingEnv: s.missing_env,
    })),
    errors,
  };
}
