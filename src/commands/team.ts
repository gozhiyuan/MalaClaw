import { loadTeam, loadAllTeams, loadAgent } from "../lib/loader.js";
import { renderTeamGraph } from "../lib/team-graph.js";
import { resolveTopology, getTopologyDescription } from "../lib/topology.js";
import type { AgentDef } from "../lib/schema.js";

export async function teamList(): Promise<void> {
  const teams = await loadAllTeams();
  if (teams.length === 0) {
    console.log("No team templates found.");
    return;
  }
  console.log(`\nTeams (${teams.length}):\n`);
  for (const t of teams) {
    const ep = t.members.find((m) => m.entry_point);
    const memberCount = t.members.length;
    console.log(
      `  ${(t.name ?? t.id).padEnd(24)} (${t.id})  ${memberCount} members  entry: ${ep?.agent ?? "—"}`,
    );
  }
}

export async function teamShow(teamId: string): Promise<void> {
  let teamDef;
  try {
    teamDef = await loadTeam(teamId);
  } catch {
    console.error(`Team "${teamId}" not found.`);
    process.exit(1);
  }

  // Build agent map
  const agentMap = new Map<string, AgentDef>();
  const missingAgents: string[] = [];

  for (const member of teamDef.members) {
    try {
      const agent = await loadAgent(member.agent);
      agentMap.set(agent.id, agent);
    } catch {
      missingAgents.push(member.agent);
    }
  }

  if (missingAgents.length > 0) {
    console.warn(`Warning: agents not found in templates: ${missingAgents.join(", ")}`);
  }

  console.log("");
  console.log(renderTeamGraph(teamDef, agentMap));

  const topology = resolveTopology(teamDef);
  const desc = getTopologyDescription(topology);
  const source = teamDef.communication ? "(explicit)" : "(inferred)";
  console.log(`\nTopology: ${topology} ${source}`);
  console.log(`  ${desc}`);

  if (teamDef.shared_memory) {
    console.log("\nShared Memory:");
    console.log(`  dir: ${teamDef.shared_memory.dir}`);
    for (const f of teamDef.shared_memory.files) {
      const writer = f.writer === "*" ? "all" : f.writer;
      console.log(`  ${f.path.padEnd(24)} ${f.access}  writer: ${writer}`);
    }
  }
}
