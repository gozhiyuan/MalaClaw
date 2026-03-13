/**
 * Claude Code adapter — stub for v1.
 *
 * The OpenClaw adapter (adapters/openclaw.ts) handles all installation in v1.
 * This stub defines the correct interface for a future claude-code adapter
 * that would write CLAUDE.md + .claude/ layout instead of ~/.openclaw/ files.
 *
 * When implementing v2:
 * - Write CLAUDE.md (agent instructions) in the project directory
 * - Write .claude/agents/<agent-id>/SOUL.md, TOOLS.md etc.
 * - No ~/.openclaw/openclaw.json patching needed
 */

import type { AgentDef, TeamDef, TeamMember } from "../schema.js";
import type { InstallAction } from "./openclaw.js";

export type ClaudeCodeInstallParams = {
  agentDef: AgentDef;
  teamDef: TeamDef;
  member: TeamMember;
  allMembers: { member: TeamMember; agent: AgentDef }[];
  projectDir: string;
  overwrite?: boolean;
};

/** Install an agent into a Claude Code project layout (v2 stub) */
export async function installAgentClaudeCode(
  _params: ClaudeCodeInstallParams,
): Promise<void> {
  // TODO v2: write .claude/agents/<agent-id>/{SOUL,TOOLS,AGENTS,IDENTITY,USER}.md
  // TODO v2: append agent reference to CLAUDE.md
  throw new Error("Claude Code adapter not yet implemented. Use the openclaw adapter (default).");
}

/** Dry-run plan for Claude Code adapter */
export function planInstallAgentClaudeCode(
  params: ClaudeCodeInstallParams,
): InstallAction[] {
  const { agentDef, projectDir } = params;
  const agentDir = `${projectDir}/.claude/agents/${agentDef.id}`;
  return [
    {
      type: "create_workspace" as const,
      path: agentDir,
      description: `[claude-code stub] Create .claude/agents/${agentDef.id}/`,
    },
    {
      type: "write_file" as const,
      path: `${projectDir}/CLAUDE.md`,
      description: `[claude-code stub] Append agent reference to CLAUDE.md`,
    },
  ];
}

/** Remove an agent from a Claude Code project layout (v2 stub) */
export async function uninstallAgentClaudeCode(
  _agentId: string,
  _projectDir: string,
): Promise<void> {
  throw new Error("Claude Code adapter not yet implemented.");
}
