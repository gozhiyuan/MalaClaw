import { loadManifest, writeLockfile } from "../lib/loader.js";
import { resolveManifest, type ResolvedPack } from "../lib/resolver.js";
import {
  installTeam,
  planInstallTeam,
  updateStoreGuidance,
  type InstallAction,
} from "../lib/adapters/openclaw.js";
import { seedTeamSharedMemory } from "../lib/memory.js";
import { loadAgent } from "../lib/loader.js";
import { resolveStoreWorkspacesRoot, resolveAgentWorkspaceDir } from "../lib/paths.js";
import fs from "node:fs/promises";

export type InstallOptions = {
  dryRun?: boolean;
  force?: boolean;
  pack?: string;
  projectDir?: string;
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
    printDryRun(packs);
    printSkillStatus(skills.map((s) => ({
      id: s.skillDef.id,
      status: s.status,
      missingEnv: s.missingEnv,
    })));
    return;
  }

  // Ensure store workspace root exists
  await fs.mkdir(resolveStoreWorkspacesRoot(), { recursive: true });

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

    await installTeam({
      teamDef: resolved.teamDef,
      agents: agentsWithMembers,
      overwrite: opts.force,
    });

    console.log(`  Seeding shared memory for ${resolved.teamDef.name ?? resolved.teamDef.id}...`);
    await seedTeamSharedMemory(resolved.teamDef);

    for (const agent of agentsWithMembers) {
      const status = opts.force ? "updated" : "created";
      console.log(`  ✓ ${agent.agentDef.name} (${agent.agentDef.id}) — workspace ${status}`);
    }
  }

  // Update main agent guidance
  console.log("\nUpdating main agent guidance (TOOLS.md, AGENTS.md)...");
  await updateStoreGuidance();

  // Write lockfile
  if (!opts.pack) {
    await writeLockfile(lockfile, opts.projectDir);
    console.log("\nWrote openclaw-store.lock");
  }

  // Report skill status
  const inactiveSkills = skills.filter((s) => s.status === "inactive");
  const activeSkills = skills.filter((s) => s.status === "active");

  if (activeSkills.length > 0) {
    console.log(`\nSkills activated: ${activeSkills.map((s) => s.skillDef.id).join(", ")}`);
  }

  if (inactiveSkills.length > 0) {
    console.log("\n⚠ Inactive skills (missing required env vars):");
    for (const s of inactiveSkills) {
      console.log(`  [INACTIVE] ${s.skillDef.id} — missing: ${s.missingEnv.join(", ")}`);
      const hints = s.skillDef.install_hints;
      if (hints && hints.length > 0) {
        for (const h of hints) {
          console.log(`    → ${h}`);
        }
      }
    }
  }

  const totalAgents = packs.reduce((n, p) => n + p.agents.length, 0);
  console.log(
    `\n✓ Installation complete. ${totalAgents} agent(s) installed across ${packs.length} pack(s).`,
  );
}

function printDryRun(packs: ResolvedPack[]): void {
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
