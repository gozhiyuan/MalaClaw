import { loadAgent, loadAllAgents, loadAllTeams } from "../lib/loader.js";
import { loadLockfile } from "../lib/loader.js";
import { findAgentTeams } from "../lib/team-graph.js";
import { resolveAgentWorkspaceDir, resolveAgentId } from "../lib/paths.js";
import fs from "node:fs/promises";

export async function agentList(): Promise<void> {
  // Show installed agents from lockfile if it exists
  const lockfile = await loadLockfile();
  if (lockfile && lockfile.packs && lockfile.packs.length > 0) {
    console.log("\nInstalled agents:\n");
    for (const pack of lockfile.packs) {
      console.log(`Pack: ${pack.id} (v${pack.version})`);
      for (const agent of pack.agents) {
        console.log(`  ${agent.id}`);
        console.log(`    workspace: ${agent.workspace}`);
      }
    }
    return;
  }

  // Fall back to available templates
  const agents = await loadAllAgents();
  console.log(`\nAvailable agent templates (${agents.length}):\n`);
  for (const a of agents) {
    const emoji = a.identity?.emoji ?? "🤖";
    console.log(`  ${emoji} ${a.name} (${a.id})  [${a.team_role?.role ?? "—"}]`);
  }
}

export async function agentShow(agentId: string): Promise<void> {
  let agentDef;
  try {
    agentDef = await loadAgent(agentId);
  } catch {
    console.error(`Agent "${agentId}" not found in templates.`);
    process.exit(1);
  }

  const allTeams = await loadAllTeams();
  const teams = findAgentTeams(agentId, allTeams);

  const emoji = agentDef.identity?.emoji ?? "🤖";
  console.log(`\n${emoji} ${agentDef.name} (${agentId})\n`);
  console.log(`Vibe:     ${agentDef.identity?.vibe ?? "—"}`);
  console.log(`Role:     ${agentDef.team_role?.role ?? "—"}`);
  console.log(`Model:    ${agentDef.model.primary}`);
  if (agentDef.model.fallback) {
    console.log(`Fallback: ${agentDef.model.fallback}`);
  }

  console.log(`\nCapabilities:`);
  const cap = agentDef.capabilities;
  console.log(`  sessions_spawn: ${cap.coordination.sessions_spawn}`);
  console.log(`  sessions_send:  ${cap.coordination.sessions_send}`);
  console.log(`  write/edit:     ${cap.file_access.write}/${cap.file_access.edit}`);
  console.log(`  exec:           ${cap.system.exec}`);
  console.log(`  cron:           ${cap.system.cron}`);

  if (agentDef.skills && agentDef.skills.length > 0) {
    console.log(`\nSkills: ${agentDef.skills.join(", ")}`);
  }

  if (teams.length > 0) {
    console.log(`\nTeams:`);
    for (const { team, role } of teams) {
      console.log(`  ${team.name ?? team.id} (${team.id}) — ${role}`);
    }
  }

  if (agentDef.team_role?.delegates_to && agentDef.team_role.delegates_to.length > 0) {
    console.log(`\nDelegates to: ${agentDef.team_role.delegates_to.join(", ")}`);
  }
}

export async function agentRefresh(agentId: string): Promise<void> {
  // Re-render and overwrite workspace files for an installed agent
  const lockfile = await loadLockfile();
  if (!lockfile) {
    console.error("No lockfile found. Run: openclaw-store install");
    process.exit(1);
  }

  let foundPack: string | null = null;
  for (const pack of lockfile.packs ?? []) {
    if (pack.agents.some((a) => a.id.endsWith(`__${agentId}`))) {
      foundPack = pack.id;
      break;
    }
  }

  if (!foundPack) {
    console.error(`Agent "${agentId}" not found in lockfile.`);
    process.exit(1);
  }

  console.log(`Refreshing ${agentId} from pack ${foundPack}...`);
  // Delegate to install with force=true for this specific agent
  // For v1, just re-run the full pack install
  const { runInstall } = await import("./install.js");
  await runInstall({ pack: foundPack, force: true });
  console.log(`✓ ${agentId} refreshed.`);
}
