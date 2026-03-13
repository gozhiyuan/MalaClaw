import { loadAllAgents, loadAllTeams, loadAllSkills, loadAllPacks } from "../lib/loader.js";
import type { AgentDef, TeamDef, SkillEntry, PackDef } from "../lib/schema.js";

export async function listAgents(): Promise<void> {
  const agents = await loadAllAgents();
  if (agents.length === 0) {
    console.log("No agent templates found.");
    return;
  }
  console.log(`\nAgents (${agents.length}):\n`);
  for (const a of agents) {
    const emoji = a.identity?.emoji ?? "🤖";
    const role = a.team_role?.role ?? "—";
    console.log(`  ${emoji} ${a.name.padEnd(22)} (${a.id})  role: ${role}  model: ${a.model.primary}`);
  }
}

export async function listTeams(): Promise<void> {
  const teams = await loadAllTeams();
  if (teams.length === 0) {
    console.log("No team templates found.");
    return;
  }
  console.log(`\nTeams (${teams.length}):\n`);
  for (const t of teams) {
    const memberCount = t.members.length;
    const leads = t.members.filter((m) => m.role === "lead").map((m) => m.agent);
    console.log(`  ${(t.name ?? t.id).padEnd(22)} (${t.id})  members: ${memberCount}  leads: ${leads.join(", ")}`);
  }
}

export async function listSkills(): Promise<void> {
  const skills = await loadAllSkills();
  if (skills.length === 0) {
    console.log("No skill templates found.");
    return;
  }
  console.log(`\nSkills (${skills.length}):\n`);
  for (const s of skills) {
    const tier = s.trust_tier;
    const envReqs = s.requires?.env?.filter((e) => e.required).map((e) => e.key) ?? [];
    const envStr = envReqs.length > 0 ? `  requires: ${envReqs.join(", ")}` : "";
    console.log(`  ${s.name.padEnd(28)} (${s.id})  trust: ${tier}${envStr}`);
  }
}

export async function listPacks(): Promise<void> {
  const packs = await loadAllPacks();
  if (packs.length === 0) {
    console.log("No packs found.");
    return;
  }
  console.log(`\nPacks (${packs.length}):\n`);
  for (const p of packs) {
    console.log(`  ${p.name.padEnd(28)} (${p.id})  v${p.version}  teams: ${p.teams.join(", ")}`);
    if (p.description) {
      console.log(`    ${p.description}`);
    }
  }
}

export async function listAll(): Promise<void> {
  await listPacks();
  await listTeams();
  await listAgents();
  await listSkills();
}
