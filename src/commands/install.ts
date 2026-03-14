import { loadManifest, loadSkill, writeLockfile } from "../lib/loader.js";
import { resolveManifest, type ResolvedPack } from "../lib/resolver.js";
import {
  installTeam,
  planInstallTeam,
  updateStoreGuidance,
  readOpenClawConfig,
  writeOpenClawConfig,
  addSkillsToAgentAllowlists,
  type InstallAction,
} from "../lib/adapters/openclaw.js";
import { seedTeamSharedMemory } from "../lib/memory.js";
import { resolveLockfilePath, resolveMainAgentWorkspaceDir, resolveManifestPath, resolveStoreWorkspacesRoot } from "../lib/paths.js";
import fs from "node:fs/promises";
import path from "node:path";
import type { LockedSkill, Lockfile, RuntimeProject } from "../lib/schema.js";
import { upsertRuntimeProject } from "../lib/runtime.js";

export type InstallOptions = {
  dryRun?: boolean;
  force?: boolean;
  pack?: string;
  projectDir?: string;
  noOpenclaw?: boolean;
};

type FinalSkillState = {
  status: LockedSkill["status"];
  missingEnv: string[];
  installError?: string;
};

export async function runInstall(opts: InstallOptions = {}): Promise<void> {
  let manifest: Awaited<ReturnType<typeof loadManifest>> | { version: 1; packs: { id: string }[]; skills: never[] };
  try {
    manifest = opts.pack
      ? { version: 1, packs: [{ id: opts.pack }], skills: [] }
      : await loadManifest(opts.projectDir);
  } catch (err) {
    if (!opts.pack && isManifestNotFoundError(err)) {
      await runZeroConfigInstall(opts);
      return;
    }
    throw err;
  }

  console.log("Resolving manifest...");
  const { project, packs, skills, lockfile } = await resolveManifest(manifest, {
    projectDir: opts.projectDir,
  });

  if (packs.length === 0 && skills.length === 0) {
    console.log("Nothing to install.");
    return;
  }

  if (opts.dryRun) {
    printDryRun(project.id, packs, Boolean(opts.noOpenclaw));
    printSkillStatus(skills.map((s) => ({
      id: s.skillDef.id,
      status: s.status,
      missingEnv: s.missingEnv,
    })));
    return;
  }

  // Ensure store workspace root exists
  await fs.mkdir(resolveStoreWorkspacesRoot(), { recursive: true });
  const finalSkillStates = new Map<string, FinalSkillState>(
    skills.map((skill) => [
      skill.skillDef.id,
      {
        status: skill.status,
        missingEnv: skill.missingEnv,
      },
    ]),
  );

  // workspaceDir → agentId map for allowlist patching after skills are installed
  const workspaceDirToAgentId = new Map<string, string>();

  // Install each pack
  for (const resolved of packs) {
    console.log(`\nInstalling pack: ${resolved.packId} (v${resolved.version})`);

    const agentsWithMembers = await Promise.all(
      resolved.agents.map(async (a) => {
        const member = resolved.teamDef.members.find((m) => m.agent === a.agentDef.id)!;
        workspaceDirToAgentId.set(a.workspaceDir, a.agentId);
        return {
          agentDef: a.agentDef,
          member,
          workspaceDir: a.workspaceDir,
          agentDir: a.agentDir,
        };
      }),
    );

    if (opts.noOpenclaw) {
      const { installTeamWorkspacesOnly } = await import("../lib/adapters/openclaw.js");
      await installTeamWorkspacesOnly({
        projectId: project.id,
        teamDef: resolved.teamDef,
        agents: agentsWithMembers,
        overwrite: opts.force,
      });
    } else {
      await installTeam({
        projectId: project.id,
        teamDef: resolved.teamDef,
        agents: agentsWithMembers,
        overwrite: opts.force,
      });
    }

    console.log(`  Seeding shared memory for ${resolved.teamDef.name ?? resolved.teamDef.id}...`);
    await seedTeamSharedMemory(project.id, resolved.teamDef);

    for (const agent of agentsWithMembers) {
      const status = opts.force ? "updated" : "created";
      console.log(`  ✓ ${agent.agentDef.name} (${agent.agentDef.id}) — workspace ${status}`);
    }
  }

  // Update main agent guidance
  if (!opts.noOpenclaw) {
    console.log("\nUpdating main agent guidance (TOOLS.md, AGENTS.md)...");
    await updateStoreGuidance();
  }

  // Install skills into each agent workspace that lists them
  // Collect (skillId → agentIds) pairs for allowlist patching after all skills are installed
  const skillToAgentIds = new Map<string, string[]>();
  if (skills.length > 0) {
    const { installSkillToWorkspaces } = await import("../lib/skill-fetch.js");
    for (const resolvedSkill of skills) {
      const targetWorkspaces = new Set<string>();
      for (const pack of packs) {
        for (const agent of pack.agents) {
          if (shouldInstallSkillForAgent(pack, agent, resolvedSkill)) {
            targetWorkspaces.add(agent.workspaceDir);
          }
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
      }
      const installedAgentIds: string[] = [];
      for (const r of results) {
        if (r.status === "installed") {
          console.log(`  ✓ Skill ${resolvedSkill.skillDef.id} → ${r.targetDir}`);
          // targetDir is workspaceDir/skills/skillId — strip /skills/<id> to get workspaceDir
          const workspaceDir = r.targetDir.replace(/\/skills\/[^/]+$/, "");
          const mappedId = workspaceDirToAgentId.get(workspaceDir);
          if (mappedId) installedAgentIds.push(mappedId);
        } else if (r.status === "failed") {
          console.warn(`  ✗ Skill ${resolvedSkill.skillDef.id} failed: ${r.reason}`);
        }
      }
      if (installedAgentIds.length > 0) {
        skillToAgentIds.set(resolvedSkill.skillDef.id, installedAgentIds);
      }
    }

    // Patch agent allowlists in openclaw.json for agents with explicit skills[] keys
    if (!opts.noOpenclaw && skillToAgentIds.size > 0) {
      const { path: configPath, config } = await readOpenClawConfig();
      for (const [skillId, agentIds] of skillToAgentIds) {
        addSkillsToAgentAllowlists(config, agentIds, [skillId]);
      }
      await writeOpenClawConfig(configPath, config);
    }
  }

  const finalLockfile = finalizeLockfileSkills(lockfile, finalSkillStates);

  // Write lockfile
  if (!opts.pack) {
    await writeLockfile(finalLockfile, opts.projectDir);
    console.log("\nWrote openclaw-store.lock");
  }

  await upsertRuntimeProject(buildRuntimeProject(project, packs, finalLockfile, {
    manifestPath: opts.pack ? undefined : resolveManifestPath(opts.projectDir),
    lockfilePath: opts.pack ? undefined : resolveLockfilePath(opts.projectDir),
  }));

  // Report skill status
  const activeSkills = finalLockfile.skills.filter((s) => s.status === "active");
  const inactiveSkills = finalLockfile.skills.filter((s) => s.status === "inactive");
  const failedSkills = finalLockfile.skills.filter((s) => s.status === "failed");

  if (activeSkills.length > 0) {
    console.log(`\nSkills activated: ${activeSkills.map((s) => s.id).join(", ")}`);
  }

  if (inactiveSkills.length > 0) {
    console.log("\n⚠ Inactive skills (missing required env vars):");
    for (const s of inactiveSkills) {
      console.log(`  [INACTIVE] ${s.id} — missing: ${s.missing_env?.join(", ")}`);
      const hints = skills.find((skill) => skill.skillDef.id === s.id)?.skillDef.install_hints;
      if (hints && hints.length > 0) {
        for (const h of hints) {
          console.log(`    → ${h}`);
        }
      }
    }
  }

  if (failedSkills.length > 0) {
    console.log("\n✗ Skills failed to install:");
    for (const s of failedSkills) {
      console.log(`  [FAILED] ${s.id} — ${s.install_error ?? "install failed"}`);
    }
  }

  const totalAgents = packs.reduce((n, p) => n + p.agents.length, 0);
  console.log(
    `\n✓ Installation complete. ${totalAgents} agent(s) installed across ${packs.length} pack(s).`,
  );
}

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

function printDryRun(projectId: string, packs: ResolvedPack[], noOpenclaw: boolean): void {
  console.log("\n[DRY RUN] Actions that would be performed:\n");

  for (const resolved of packs) {
    console.log(`Pack: ${resolved.packId} (v${resolved.version})`);

    const agentsWithMembers = resolved.agents.map((a) => ({
      agentDef: a.agentDef,
      member: resolved.teamDef.members.find((m) => m.agent === a.agentDef.id)!,
      workspaceDir: a.workspaceDir,
      agentDir: a.agentDir,
    }));

    const actions: InstallAction[] = planInstallTeam({
      projectId,
      teamDef: resolved.teamDef,
      agents: agentsWithMembers,
      dryRun: true,
      skipOpenClaw: noOpenclaw,
    });

    for (const action of actions) {
      console.log(`  [${action.type}] ${action.description}`);
      console.log(`    → ${action.path}`);
    }
  }
}

function shouldInstallSkillForAgent(
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

function buildRuntimeProject(
  project: { id: string; name?: string; description?: string; starter?: string; entryTeam?: string; projectDir: string },
  packs: ResolvedPack[],
  lockfile: Lockfile,
  opts: { manifestPath?: string; lockfilePath?: string },
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
    updated_at: new Date().toISOString(),
  };
}

type SkillStatus = { id: string; status: "active" | "inactive"; missingEnv: string[] };

function printSkillStatus(skills: SkillStatus[]): void {
  if (skills.length === 0) return;
  console.log("\nSkills:");
  for (const s of skills) {
    if (s.status === "active") {
      console.log(`  [ACTIVE] ${s.id}`);
    } else {
      console.log(`  [INACTIVE] ${s.id} — missing: ${s.missingEnv.join(", ")}`);
    }
  }
}

function isManifestNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("No openclaw-store.yaml found");
}

async function runZeroConfigInstall(opts: InstallOptions): Promise<void> {
  const mainWorkspaceDir = resolveMainAgentWorkspaceDir();
  console.log("openclaw-store: no manifest found.");
  console.log("Installing openclaw-store-manager skill into OpenClaw main agent workspace...\n");

  const skillDef = await loadSkill("openclaw-store-manager");
  const { installSkillToWorkspaces } = await import("../lib/skill-fetch.js");
  const results = await installSkillToWorkspaces(skillDef, [mainWorkspaceDir], "active");

  const skillDir = path.join(mainWorkspaceDir, "skills", "openclaw-store-manager");
  const installed = results.some((r) => r.status === "installed");
  if (installed) {
    console.log(`✓ Skill installed: openclaw-store-manager`);
    console.log(`  → ${skillDir}\n`);
  } else {
    const reason = results[0]?.reason ?? "unknown error";
    console.warn(`✗ Failed to install openclaw-store-manager: ${reason}`);
    return;
  }

  if (!opts.noOpenclaw) {
    await updateStoreGuidance();
  }

  console.log("The skill is now available in OpenClaw. Ask your agent to:");
  console.log("  1. Run: openclaw-store starter list");
  console.log("  2. Pick a starter and run: openclaw-store starter init <id> ./my-project");
  console.log("  3. Then: openclaw-store install");
  console.log("\nFor a full managed setup, run: openclaw-store init");
}
