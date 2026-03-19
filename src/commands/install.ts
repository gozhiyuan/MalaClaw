import { loadManifest, loadSkill } from "../lib/loader.js";
import { resolveManifest, type ResolvedPack } from "../lib/resolver.js";
import type { InstallAction } from "../lib/adapters/base.js";
import { getProvisioner } from "../lib/adapters/registry.js";
import { resolveMainAgentWorkspaceDir } from "../lib/paths.js";
import path from "node:path";
import {
  runHeadlessInstall,
  finalizeLockfileSkills,
  shouldInstallSkillForAgent,
  buildRuntimeProject,
  type InstallOpts,
} from "../lib/install-headless.js";
import type { RuntimeTarget } from "../lib/schema.js";

export type InstallOptions = {
  dryRun?: boolean;
  force?: boolean;
  pack?: string;
  projectDir?: string;
};

// Re-export pure helpers so existing consumers (tests, etc.) keep working
export { finalizeLockfileSkills, shouldInstallSkillForAgent, buildRuntimeProject };

export async function runInstall(opts: InstallOptions = {}): Promise<void> {
  // The dryRun path needs resolved pack data for printDryRun, so we handle it before headless
  if (opts.dryRun) {
    let manifest: Awaited<ReturnType<typeof loadManifest>>;
    try {
      manifest = opts.pack
        ? { version: 1, runtime: "openclaw" as const, packs: [{ id: opts.pack }], skills: [] }
        : await loadManifest(opts.projectDir);
    } catch (err) {
      if (!opts.pack && isManifestNotFoundError(err)) {
        await runZeroConfigInstall(opts);
        return;
      }
      throw err;
    }
    const { project, packs, skills } = await resolveManifest(manifest, {
      projectDir: opts.projectDir,
    });
    const runtime = (manifest.runtime ?? "openclaw") as RuntimeTarget;
    if (packs.length === 0 && skills.length === 0) {
      console.log("Nothing to install.");
      return;
    }
    await printDryRun(project.id, packs, runtime);
    printSkillStatus(skills.map((s) => ({
      id: s.skillDef.id,
      status: s.status,
      missingEnv: s.missingEnv,
    })));
    return;
  }

  try {
    const result = await runHeadlessInstall({
      ...opts,
      onProgress: (p) => {
        if (p.phase === "installing" || p.phase === "finalizing" || p.phase === "resolving") {
          console.log(p.message);
        }
      },
    } as InstallOpts);

    // Report skill status from result
    const activeSkills = result.skillStatuses.filter((s) => s.status === "active");
    const inactiveSkills = result.skillStatuses.filter((s) => s.status === "inactive");
    const failedSkills = result.skillStatuses.filter((s) => s.status === "failed");

    if (activeSkills.length > 0) {
      console.log(`\nSkills activated: ${activeSkills.map((s) => s.id).join(", ")}`);
    }
    if (inactiveSkills.length > 0) {
      console.log("\n⚠ Inactive skills (missing required env vars):");
      for (const s of inactiveSkills) {
        console.log(`  [INACTIVE] ${s.id} — missing: ${(s.missingEnv ?? []).join(", ")}`);
      }
    }
    if (failedSkills.length > 0) {
      console.log("\n✗ Skills failed to install:");
      for (const s of failedSkills) {
        console.log(`  [FAILED] ${s.id}`);
      }
    }
  } catch (err) {
    if (!opts.pack && isManifestNotFoundError(err)) {
      await runZeroConfigInstall(opts);
      return;
    }
    throw err;
  }
}

async function printDryRun(projectId: string, packs: ResolvedPack[], runtime: RuntimeTarget): Promise<void> {
  const provisioner = getProvisioner(runtime);
  console.log(`\n[DRY RUN] Actions that would be performed (runtime: ${runtime}):\n`);
  for (const resolved of packs) {
    console.log(`Pack: ${resolved.packId} (v${resolved.version})`);
    const agentsWithMembers = resolved.agents.map((a) => ({
      agentDef: a.agentDef,
      member: resolved.teamDef.members.find((m) => m.agent === a.agentDef.id)!,
      workspaceDir: a.workspaceDir,
      agentDir: a.agentDir,
    }));
    const actions: InstallAction[] = await provisioner.planInstallTeam({
      projectId,
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

function isManifestNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("No malaclaw.yaml found");
}

async function runZeroConfigInstall(opts: InstallOptions): Promise<void> {
  const mainWorkspaceDir = resolveMainAgentWorkspaceDir();
  console.log("malaclaw: no manifest found.");
  console.log("Installing malaclaw-cook skill into OpenClaw main agent workspace...\n");
  const skillDef = await loadSkill("malaclaw-cook");
  const { installSkillToWorkspaces } = await import("../lib/skill-fetch.js");
  const results = await installSkillToWorkspaces(skillDef, [mainWorkspaceDir], "active");
  const skillDir = path.join(mainWorkspaceDir, "skills", "malaclaw-cook");
  const installed = results.some((r) => r.status === "installed");
  if (installed) {
    console.log(`✓ Skill installed: malaclaw-cook`);
    console.log(`  → ${skillDir}\n`);
  } else {
    const reason = results[0]?.reason ?? "unknown error";
    console.warn(`✗ Failed to install malaclaw-cook: ${reason}`);
    return;
  }
  console.log("The skill is now available in OpenClaw. Ask your agent to:");
  console.log("  1. Run: malaclaw starter list");
  console.log("  2. Pick a starter and run: malaclaw starter init <id> ./my-project");
  console.log("  3. Then: malaclaw install");
  console.log("\nFor a full managed setup, run: malaclaw init");
}
