import type { TeamDef, AgentDef, GraphEdge } from "./schema.js";

/** Resolve full member details from a team definition */
export type MemberDetail = {
  agent: AgentDef;
  role: "lead" | "specialist" | "reviewer";
  entry_point: boolean;
};

export function resolveMemberDetails(
  teamDef: TeamDef,
  agentMap: Map<string, AgentDef>,
): MemberDetail[] {
  return teamDef.members.map((m) => {
    const agent = agentMap.get(m.agent);
    if (!agent) {
      throw new Error(`Agent "${m.agent}" referenced by team "${teamDef.id}" not found`);
    }
    return { agent, role: m.role, entry_point: m.entry_point ?? false };
  });
}

/** Render an ASCII graph of the team's delegation relationships */
export function renderTeamGraph(teamDef: TeamDef, agentMap: Map<string, AgentDef>): string {
  const members = resolveMemberDetails(teamDef, agentMap);
  const edges = teamDef.graph ?? [];

  const lines: string[] = [
    `Team: ${teamDef.name ?? teamDef.id}`,
    "=".repeat(40),
    "",
  ];

  // Entry point
  const entryPoint = members.find((m) => m.entry_point);
  if (entryPoint) {
    lines.push(`[ENTRY] ${entryPoint.agent.name} (${entryPoint.agent.id})`);
  }

  // Leads
  const leads = members.filter((m) => m.role === "lead" && !m.entry_point);
  for (const l of leads) {
    lines.push(`  [LEAD] ${l.agent.name} (${l.agent.id})`);
  }

  // Specialists and reviewers
  const specialists = members.filter((m) => m.role === "specialist");
  const reviewers = members.filter((m) => m.role === "reviewer");

  if (specialists.length > 0) {
    lines.push("    Specialists:");
    for (const s of specialists) {
      lines.push(`      - ${s.agent.name} (${s.agent.id})`);
    }
  }

  if (reviewers.length > 0) {
    lines.push("    Reviewers:");
    for (const r of reviewers) {
      lines.push(`      - ${r.agent.name} (${r.agent.id})`);
    }
  }

  if (edges.length > 0) {
    lines.push("", "Relationships:");
    for (const edge of edges) {
      const fromAgent = agentMap.get(edge.from);
      const toAgent = agentMap.get(edge.to);
      const fromName = fromAgent ? fromAgent.name : edge.from;
      const toName = toAgent ? toAgent.name : edge.to;
      const rel = edge.relationship === "delegates_to" ? "→" : "⟹ review";
      lines.push(`  ${fromName} ${rel} ${toName}`);
    }
  }

  return lines.join("\n");
}

/** Find all teams that include a given agent ID */
export function findAgentTeams(
  agentId: string,
  allTeams: TeamDef[],
): Array<{ team: TeamDef; role: string }> {
  const result: Array<{ team: TeamDef; role: string }> = [];
  for (const team of allTeams) {
    const member = team.members.find((m) => m.agent === agentId);
    if (member) {
      result.push({ team, role: member.role });
    }
  }
  return result;
}

/** Get all agents that are leads (can spawn sub-agents) */
export function getLeadAgentIds(teamDef: TeamDef): string[] {
  return teamDef.members.filter((m) => m.role === "lead").map((m) => m.agent);
}

/** Topological sort of agents for install order (leads before specialists) */
export function sortMembersForInstall(
  teamDef: TeamDef,
  agentMap: Map<string, AgentDef>,
): MemberDetail[] {
  const members = resolveMemberDetails(teamDef, agentMap);
  return [
    ...members.filter((m) => m.entry_point),
    ...members.filter((m) => m.role === "lead" && !m.entry_point),
    ...members.filter((m) => m.role === "specialist"),
    ...members.filter((m) => m.role === "reviewer"),
  ];
}
