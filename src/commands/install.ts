import { loadManifest, writeLockfile } from "../lib/loader.js";
import { resolveManifest, type ResolvedPack } from "../lib/resolver.js";
import {
  installTeam,
  planInstallTeam,
  updateStoreGuidance,
  type InstallAction,
} from "../lib/adapters/openclaw.js";
import { seedTeamSharedMemory } from "../lib/memory.js";
import { resolveStoreWorkspacesRoot } from "../lib/paths.js";
import fs from "node:fs/promises";
import type { LockedSkill, Lockfile } from "../lib/schema.js";

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
  const manifest = opts.pack
    ? { version: 1, packs: [{ id: opts.pack }], skills: [] }
    : await loadManifest(opts.projectDir);

  console.log("Resolving manifest...");
  const { packs, skills, lockfile } = await resolveManifest(manifest);

  if (packs.length === 0 && skills.length === 0) {
    console.log("Nothing to install.");
    return;
  }

  if (opts.dryRun) {
    printDryRun(packs, Boolean(opts.noOpenclaw));
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

  // Install each pack
  for (const resolved of packs) {
    console.log(`\nInstalling pack: ${resolved.packId} (v${resolved.version})`);

    const agentsWithMembers = await Promise.all(
      resolved.agents.map(async (a) => {
        const member = resolved.teamDef.members.find((m) => m.agent === a.agentDef.id)!;
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
        teamDef: resolved.teamDef,
        agents: agentsWithMembers,
        overwrite: opts.force,
      });
    } else {
      await installTeam({
        teamDef: resolved.teamDef,
        agents: agentsWithMembers,
        overwrite: opts.force,
      });
    }

    console.log(`  Seeding shared memory for ${resolved.teamDef.name ?? resolved.teamDef.id}...`);
    await seedTeamSharedMemory(resolved.teamDef);

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
  if (skills.length > 0) {
    const { installSkillToWorkspaces } = await import("../lib/skill-fetch.js");
    for (const resolvedSkill of skills) {
      const targetWorkspaces = new Set<string>();
      for (const pack of packs) {
        for (const agent of pack.agents) {
          if (agent.agentDef.skills?.includes(resolvedSkill.skillDef.id)) {
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
      for (const r of results) {
        if (r.status === "installed") {
          console.log(`  ✓ Skill ${resolvedSkill.skillDef.id} → ${r.targetDir}`);
        } else if (r.status === "failed") {
          console.warn(`  ✗ Skill ${resolvedSkill.skillDef.id} failed: ${r.reason}`);
        }
      }
    }
  }

  const finalLockfile = finalizeLockfileSkills(lockfile, finalSkillStates);

  // Write lockfile
  if (!opts.pack) {
    await writeLockfile(finalLockfile, opts.projectDir);
    console.log("\nWrote openclaw-store.lock");
  }

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

function printDryRun(packs: ResolvedPack[], noOpenclaw: boolean): void {
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
