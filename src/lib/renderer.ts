import type { AgentDef, TeamDef, TeamMember, SharedMemoryFile } from "./schema.js";
import { resolveTopology, getTopologyDescription, getTopologyGuidance } from "./topology.js";

export type RenderContext = {
  agent: AgentDef;
  team: TeamDef;
  member: TeamMember;
};

/** Substitute {{variable.path}} placeholders using dot-notation */
function substitute(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, key: string) => {
    const parts = key.split(".");
    let value: unknown = ctx;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return match;
      value = (value as Record<string, unknown>)[part];
    }
    return value != null ? String(value) : match;
  });
}

function subCtx(agent: AgentDef, team: TeamDef): Record<string, unknown> {
  return {
    agent: { ...agent },
    team: { id: team.id, name: team.name ?? team.id },
  };
}

// ── Bootstrap file generators ────────────────────────────────────────────────

export function renderSoul(ctx: RenderContext): string {
  const { agent, team } = ctx;
  const c = subCtx(agent, team);
  const persona = substitute(agent.soul.persona, c);
  const tone = agent.soul.tone ? substitute(agent.soul.tone, c) : "";
  const boundaries = agent.soul.boundaries ?? [];

  const lines: string[] = [
    `# Soul — ${agent.name}`,
    "",
    persona,
  ];

  if (tone) {
    lines.push("", "## Tone", "", tone);
  }

  if (boundaries.length > 0) {
    lines.push("", "## Boundaries", "");
    for (const b of boundaries) {
      lines.push(`- ${substitute(b, c)}`);
    }
  }

  return lines.join("\n") + "\n";
}

export function renderIdentity(ctx: RenderContext): string {
  const { agent, team } = ctx;
  const emoji = agent.identity?.emoji ?? "🤖";
  const vibe = agent.identity?.vibe ?? "";
  const role = agent.team_role?.role ?? ctx.member.role;

  const lines: string[] = [
    `# Identity`,
    "",
    `${emoji} **${agent.name}**`,
    "",
    `> ${vibe}`,
    "",
    `## Role`,
    "",
    `**${role}** in **${team.name ?? team.id}**`,
    "",
    `## Model`,
    "",
    `- Primary: \`${agent.model.primary}\``,
  ];

  if (agent.model.fallback) {
    lines.push(`- Fallback: \`${agent.model.fallback}\``);
  }

  return lines.join("\n") + "\n";
}

export function renderTools(ctx: RenderContext): string {
  const { agent } = ctx;
  const cap = agent.capabilities;

  const bool = (v: boolean) => (v ? "✓ enabled" : "✗ disabled");

  const lines: string[] = [
    `# Tool Capabilities — ${agent.name}`,
    "",
    "## Coordination",
    "",
    `- **sessions_spawn** (orchestrate sub-agents): ${bool(cap.coordination.sessions_spawn)}`,
    `- **sessions_send** (direct peer messaging): ${bool(cap.coordination.sessions_send)}`,
    "",
    "> **Important:** All coordination happens via append-only shared memory files.",
    "> Never attempt to directly message other agents.",
    "",
    "## File Access",
    "",
    `- **write:** ${bool(cap.file_access.write)}`,
    `- **edit:** ${bool(cap.file_access.edit)}`,
    `- **apply_patch:** ${bool(cap.file_access.apply_patch)}`,
    "",
    "## System",
    "",
    `- **exec:** ${bool(cap.system.exec)}`,
    `- **cron:** ${bool(cap.system.cron)}`,
    `- **gateway:** ${bool(cap.system.gateway)}`,
  ];

  if (agent.skills && agent.skills.length > 0) {
    lines.push("", "## Skills", "");
    for (const s of agent.skills) {
      lines.push(`- ${s}`);
    }
  }

  return lines.join("\n") + "\n";
}

export function renderAgentsFile(
  ctx: RenderContext,
  allMembers: { member: TeamMember; agent: AgentDef }[],
): string {
  const { agent, team, member } = ctx;
  const sharedMemory = team.shared_memory;
  const role = agent.team_role?.role ?? member.role;
  const delegatesTo = agent.team_role?.delegates_to ?? [];

  const lines: string[] = [
    `# Team: ${team.name ?? team.id}`,
    "",
    `## Your Role`,
    "",
    `You are the **${role}** — **${agent.name}**.`,
  ];

  if (role === "lead") {
    lines.push(
      "",
      "As a **lead**, you can spawn sub-agents for delegated tasks (`sessions_spawn: true`).",
      "You coordinate via shared memory files — never send direct messages to peers.",
    );
  } else if (role === "specialist") {
    lines.push(
      "",
      "As a **specialist**, you receive tasks from leads.",
      "Report progress by appending to `tasks-log.md`. Never overwrite shared files.",
    );
  } else if (role === "reviewer") {
    lines.push(
      "",
      "As a **reviewer**, you review work when requested by a lead.",
      "Record findings by appending to `tasks-log.md`.",
    );
  }

  lines.push("", "## Team Members", "");
  for (const { member: m, agent: a } of allMembers) {
    const isMe = a.id === agent.id;
    const ep = m.entry_point ? " *(entry point)*" : "";
    const me = isMe ? " ← **YOU**" : "";
    lines.push(`- **${a.name}** (\`${a.id}\`) — ${m.role}${ep}${me}`);
  }

  if (delegatesTo.length > 0) {
    lines.push("", "## Delegation", "", "You delegate tasks to:");
    for (const d of delegatesTo) {
      const target = allMembers.find((x) => x.agent.id === d);
      const name = target ? target.agent.name : d;
      lines.push(`- **${name}** (\`${d}\`)`);
    }
  }

  // Topology coordination guidance
  const topology = resolveTopology(team);
  lines.push("", "## Communication Topology", "");
  lines.push(`This team uses **${topology}** topology.`);
  lines.push("");
  lines.push(getTopologyDescription(topology));
  lines.push("");
  lines.push("**Your coordination rules:**");
  lines.push(...getTopologyGuidance(topology, role));

  if (sharedMemory && sharedMemory.files.length > 0) {
    lines.push("", "## Shared Memory", "");
    lines.push(
      "| File | Access | Writer | Your Access |",
      "|------|--------|--------|-------------|",
    );
    for (const f of sharedMemory.files) {
      const yourAccess = getAccessDescription(f, agent.id);
      lines.push(
        `| \`${f.path}\` | ${f.access} | ${f.writer === "*" ? "all" : f.writer} | ${yourAccess} |`,
      );
    }

    lines.push("", "### Memory Rules", "");
    lines.push("- **single-writer**: Only the designated writer may modify this file.");
    lines.push("- **append-only**: Any agent may append; no overwrites or edits allowed.");
    lines.push("- **private**: Only the owning agent reads and writes.");
    lines.push(
      "",
      "> Violating these rules causes race conditions. Always respect access patterns.",
    );
  }

  if (agent.memory?.private_notes) {
    lines.push("", "## Private Notes", "", `Your private notes file: \`${agent.memory.private_notes}\``);
    lines.push("Only you read and write this file.");
  }

  return lines.join("\n") + "\n";
}

function getAccessDescription(file: SharedMemoryFile, agentId: string): string {
  if (file.access === "private") {
    return file.writer === agentId ? "read + write" : "no access";
  }
  if (file.access === "single-writer") {
    return file.writer === agentId ? "**WRITE** (you are the sole writer)" : "read only";
  }
  // append-only
  if (file.writer === "*" || file.writer === agentId) {
    return "**APPEND ONLY** (no overwrites)";
  }
  return "read only";
}

export function renderUser(ctx: RenderContext): string {
  const { agent, team, member } = ctx;
  const role = agent.team_role?.role ?? member.role;
  const entryPoint = member.entry_point ?? false;

  const lines: string[] = [
    `# ${agent.name}`,
    "",
    `**Team:** ${team.name ?? team.id}`,
    `**Role:** ${role}${entryPoint ? " *(entry point)*" : ""}`,
    `**Model:** ${agent.model.primary}`,
    "",
    "## Purpose",
    "",
    agent.identity?.vibe ?? agent.soul.persona.split("\n")[0],
  ];

  if (entryPoint) {
    lines.push(
      "",
      "## How to Invoke",
      "",
      `This is the entry point for the **${team.name ?? team.id}** team.`,
      "Start here when delegating work to this team.",
    );
  }

  return lines.join("\n") + "\n";
}

export function renderMemory(ctx: RenderContext): string {
  const { agent, team } = ctx;
  const lines = [
    `# Memory — ${agent.name}`, "",
    "## Native memory tools (this workspace)",
    "",
    "OpenClaw provides `memory_search` and `memory_get` for semantic search over",
    "files in this agent's workspace directory (MEMORY.md, memory/*.md).",
    "",
  ];
  if (agent.memory?.private_notes) {
    lines.push("## Private notes", "", `Your private notes: \`${agent.memory.private_notes}\``, "");
  }
  if (team.shared_memory?.files?.length) {
    lines.push(
      "## Team shared memory",
      "",
      "Shared memory files live outside this workspace — access them by file path,",
      "not via memory_search (which only indexes this agent's workspace).",
      "",
      "See AGENTS.md for shared memory file paths and access policies.",
    );
  }
  return lines.join("\n") + "\n";
}

/** Render all 6 bootstrap files for an agent */
export function renderBootstrapFiles(
  agentDef: AgentDef,
  teamDef: TeamDef,
  member: TeamMember,
  allMembers: { member: TeamMember; agent: AgentDef }[],
): Record<string, string> {
  const ctx: RenderContext = { agent: agentDef, team: teamDef, member };
  return {
    "SOUL.md": renderSoul(ctx),
    "IDENTITY.md": renderIdentity(ctx),
    "TOOLS.md": renderTools(ctx),
    "AGENTS.md": renderAgentsFile(ctx, allMembers),
    "USER.md": renderUser(ctx),
    "MEMORY.md": renderMemory(ctx),
  };
}
