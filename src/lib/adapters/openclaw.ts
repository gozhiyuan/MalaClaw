/**
 * OpenClaw adapter — installs packs into ~/.openclaw/
 *
 * Ported and extended from antfarm's installer modules:
 *   - openclaw-config.ts  → readOpenClawConfig / writeOpenClawConfig
 *   - workspace-files.ts  → writeBootstrapFile
 *   - agent-provision.ts  → provisionAgent
 *   - main-agent-guidance.ts → updateStoreGuidance / removeStoreGuidance
 *   - subagent-allowlist.ts → addToAllowlist / removeFromAllowlist
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import {
  resolveOpenClawConfigPath,
  resolveMainAgentWorkspaceDir,
  resolveAgentId,
} from "../paths.js";
import { renderBootstrapFiles } from "../renderer.js";
import type { AgentDef, TeamDef, TeamMember } from "../schema.js";

// ── openclaw.json read/write ─────────────────────────────────────────────────

export type OpenClawConfig = Record<string, unknown> & {
  agents?: {
    defaults?: {
      model?: string | { primary?: string };
      workspace?: string;
      subagents?: { allowAgents?: string[] };
    };
    list?: Array<Record<string, unknown>>;
  };
  tools?: {
    agentToAgent?: {
      enabled?: boolean;
      allow?: string[];
    };
  };
};

export async function readOpenClawConfig(): Promise<{ path: string; config: OpenClawConfig }> {
  const configPath = resolveOpenClawConfigPath();
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const config = JSON5.parse(raw) as OpenClawConfig;
    return { path: configPath, config };
  } catch (err) {
    const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT";
    if (isNotFound) {
      const configPath = resolveOpenClawConfigPath();
      throw new Error(
        `OpenClaw config not found at ${configPath}.\n` +
        `Either install OpenClaw first, or run: openclaw-store install --no-openclaw`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read OpenClaw config at ${configPath}: ${msg}`);
  }
}

export async function writeOpenClawConfig(
  configPath: string,
  config: OpenClawConfig,
): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Subagent allowlist (ported from antfarm/subagent-allowlist.ts) ────────────

function normalizeAllow(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((e): e is string => typeof e === "string");
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function ensureAgentToAgent(config: OpenClawConfig) {
  if (!config.tools) config.tools = {};
  if (!config.tools.agentToAgent) config.tools.agentToAgent = { enabled: true };
  return config.tools.agentToAgent;
}

export function addToAllowlist(config: OpenClawConfig, agentIds: string[]): void {
  if (agentIds.length === 0) return;
  const a2a = ensureAgentToAgent(config);
  const existing = normalizeAllow(a2a.allow);
  if (existing.includes("*")) return;
  a2a.allow = uniq([...existing, ...agentIds]);
}

export function removeFromAllowlist(config: OpenClawConfig, agentIds: string[]): void {
  if (agentIds.length === 0) return;
  const a2a = ensureAgentToAgent(config);
  const existing = normalizeAllow(a2a.allow);
  if (existing.includes("*")) return;
  const next = existing.filter((e) => !agentIds.includes(e));
  a2a.allow = next.length > 0 ? next : undefined;
}

// ── Agent entry in openclaw.json ─────────────────────────────────────────────

type AgentEntry = Record<string, unknown>;

function buildAgentEntry(
  agentId: string,
  agentDef: AgentDef,
  workspaceDir: string,
  agentDir: string,
): AgentEntry {
  const entry: AgentEntry = {
    id: agentId,
    name: agentDef.name,
    model: agentDef.model.primary,
    workspace: workspaceDir,
    agentDir,
  };
  if (agentDef.skills !== undefined) {
    entry.skills = agentDef.skills;
  }
  return entry;
}

export function addSkillsToAgentAllowlists(
  config: OpenClawConfig,
  agentIds: string[],
  skillIds: string[],
): void {
  if (skillIds.length === 0 || agentIds.length === 0) return;
  const list = Array.isArray(config.agents?.list) ? config.agents!.list! : [];
  for (const entry of list) {
    if (!agentIds.includes(entry.id as string)) continue;
    if (!Object.prototype.hasOwnProperty.call(entry, "skills")) continue;
    const existing = Array.isArray(entry.skills) ? (entry.skills as string[]) : [];
    entry.skills = uniq([...existing, ...skillIds]);
  }
}

function filterStoreAgents(
  list: AgentEntry[],
  projectId: string,
  teamId: string,
): AgentEntry[] {
  const prefix = resolveAgentId(projectId, teamId, "").replace(/__$/, "__");
  return list.filter((e) => {
    const id = typeof e.id === "string" ? e.id : "";
    return !id.startsWith(prefix);
  });
}

export function upsertAgentEntries(
  config: OpenClawConfig,
  entries: AgentEntry[],
): void {
  if (!config.agents) config.agents = {};
  const list = Array.isArray(config.agents.list) ? config.agents.list : [];
  // Remove any existing entries with same IDs, then append
  const existingIds = new Set(entries.map((e) => e.id));
  const filtered = list.filter((e) => !existingIds.has(e.id as string));
  config.agents.list = [...filtered, ...entries];
}

export function removeTeamAgentEntries(
  config: OpenClawConfig,
  projectId: string,
  teamId: string,
  agentIds: string[] = [],
): AgentEntry[] {
  const list = Array.isArray(config.agents?.list) ? config.agents!.list! : [];
  const prefix = resolveAgentId(projectId, teamId, "").replace(/__$/, "__");
  const exactIds = new Set(agentIds);
  const removed = list.filter((e) => {
    const id = typeof e.id === "string" ? e.id : "";
    return id.startsWith(prefix) || exactIds.has(id);
  });
  if (config.agents) {
    config.agents.list = list.filter((e) => !removed.includes(e));
  }
  return removed;
}

// ── Main agent guidance (ported from antfarm/main-agent-guidance.ts) ─────────

const STORE_BLOCK_START = "<!-- openclaw-store -->";
const STORE_BLOCK_END = "<!-- /openclaw-store -->";

const TOOLS_BLOCK = `${STORE_BLOCK_START}
# OpenClaw Store

openclaw-store manages projects, agent teams, and skills on top of OpenClaw.

## Quick start

The \`openclaw-store-manager\` skill is available in your workspace.
Use it to discover and bootstrap projects:

1. \`openclaw-store starter list\` — browse available demo projects
2. \`openclaw-store starter suggest "<idea>"\` — find the closest starter
3. \`openclaw-store starter init <id> ./my-project\` — scaffold
4. \`openclaw-store install\` — provision agents and skills

## CLI reference

- Project status:    \`openclaw-store project status\`
- Health check:      \`openclaw-store doctor\`
- Team graph:        \`openclaw-store team show <id>\`
- Skill status:      \`openclaw-store skill check\`

## Coordination

Store-managed agents communicate via shared memory files in:
  ~/.openclaw-store/workspaces/store/<project>/<team>/shared/memory/

Never send direct messages to store agents — use memory files.
${STORE_BLOCK_END}
`;

const AGENTS_BLOCK = `${STORE_BLOCK_START}
# OpenClaw Store — Agent Policy

## Installed Teams
Teams are installed into project-scoped workspaces via openclaw-store. Each team has an entry point agent.

## Coordination Rules
- Use memory files for all inter-agent communication
- Leads spawn sub-agents for tasks (sessions_spawn)
- No direct peer messaging (sessions_send = false)
- Check the project's team shared memory dir for task queue and status

## Finding Agents
\`openclaw-store agent list\` — lists all installed agents
\`openclaw-store project list\` — lists installed projects and entry points
\`openclaw-store team show <id>\` — shows team graph and entry point
${STORE_BLOCK_END}
`;

function removeBlock(content: string): string {
  const start = content.indexOf(STORE_BLOCK_START);
  const end = content.indexOf(STORE_BLOCK_END);
  if (start === -1 || end === -1) return content;
  const after = end + STORE_BLOCK_END.length;
  const beforeText = content.slice(0, start).trimEnd();
  const afterText = content.slice(after).trimStart();
  if (!beforeText) return afterText ? `${afterText}\n` : "";
  if (!afterText) return `${beforeText}\n`;
  return `${beforeText}\n\n${afterText}\n`;
}

function upsertBlock(content: string, block: string): string {
  const cleaned = removeBlock(content);
  if (!cleaned.trim()) return `${block}\n`;
  return `${cleaned.trimEnd()}\n\n${block}\n`;
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function updateStoreGuidance(): Promise<void> {
  const { config } = await readOpenClawConfig();
  const workspaceDir =
    (config.agents?.defaults as Record<string, unknown> | undefined)?.workspace as string | undefined
    ?? resolveMainAgentWorkspaceDir();

  const toolsPath = path.join(workspaceDir, "TOOLS.md");
  const agentsPath = path.join(workspaceDir, "AGENTS.md");

  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(toolsPath, upsertBlock(await readFileOrEmpty(toolsPath), TOOLS_BLOCK), "utf-8");
  await fs.writeFile(agentsPath, upsertBlock(await readFileOrEmpty(agentsPath), AGENTS_BLOCK), "utf-8");
}

export async function removeStoreGuidance(): Promise<void> {
  const { config } = await readOpenClawConfig();
  const workspaceDir =
    (config.agents?.defaults as Record<string, unknown> | undefined)?.workspace as string | undefined
    ?? resolveMainAgentWorkspaceDir();

  const toolsPath = path.join(workspaceDir, "TOOLS.md");
  const agentsPath = path.join(workspaceDir, "AGENTS.md");

  const toolsContent = await readFileOrEmpty(toolsPath);
  const agentsContent = await readFileOrEmpty(agentsPath);

  if (toolsContent) await fs.writeFile(toolsPath, removeBlock(toolsContent), "utf-8");
  if (agentsContent) await fs.writeFile(agentsPath, removeBlock(agentsContent), "utf-8");
}

// ── Agent provisioning ───────────────────────────────────────────────────────

export type ProvisionParams = {
  agentDef: AgentDef;
  teamDef: TeamDef;
  member: TeamMember;
  allMembers: { member: TeamMember; agent: AgentDef }[];
  workspaceDir: string;
  agentDir: string;
  createAgentDir?: boolean;
  overwrite?: boolean;
};

export async function provisionAgent(params: ProvisionParams): Promise<void> {
  await fs.mkdir(params.workspaceDir, { recursive: true });
  if (params.createAgentDir !== false) {
    await fs.mkdir(params.agentDir, { recursive: true });
  }

  const files = renderBootstrapFiles(
    params.agentDef,
    params.teamDef,
    params.member,
    params.allMembers,
  );

  for (const [fileName, content] of Object.entries(files)) {
    const filePath = path.join(params.workspaceDir, fileName);
    try {
      await fs.access(filePath);
      if (!params.overwrite) continue; // skip if exists and not forcing
    } catch {
      // file doesn't exist, write it
    }
    await fs.writeFile(filePath, content, "utf-8");
  }
}

// ── Full install for a team ──────────────────────────────────────────────────

export type InstallTeamParams = {
  projectId: string;
  teamDef: TeamDef;
  agents: { agentDef: AgentDef; member: TeamMember; workspaceDir: string; agentDir: string }[];
  overwrite?: boolean;
  dryRun?: boolean;
  skipOpenClaw?: boolean;
};

export type InstallAction = {
  type: "create_workspace" | "write_file" | "patch_config" | "update_guidance" | "create_agent_dir";
  path: string;
  description: string;
};

export async function installTeam(params: InstallTeamParams): Promise<void> {
  if (params.dryRun) {
    throw new Error("Use planInstallTeam for dry-run");
  }

  const allMembers = params.agents.map((a) => ({
    member: a.member,
    agent: a.agentDef,
  }));

  // Provision each agent
  for (const agent of params.agents) {
    await provisionAgent({
      agentDef: agent.agentDef,
      teamDef: params.teamDef,
      member: agent.member,
      allMembers,
      workspaceDir: agent.workspaceDir,
      agentDir: agent.agentDir,
      createAgentDir: true,
      overwrite: params.overwrite,
    });
  }

  // Patch openclaw.json
  const { path: configPath, config } = await readOpenClawConfig();

  const leadAgentIds: string[] = [];
  const entries: AgentEntry[] = [];

  for (const agent of params.agents) {
    const agentId = resolveAgentId(params.projectId, params.teamDef.id, agent.agentDef.id);
    entries.push(
      buildAgentEntry(agentId, agent.agentDef, agent.workspaceDir, agent.agentDir),
    );
    // Only leads with sessions_spawn get added to allowlist
    if (agent.agentDef.capabilities.coordination.sessions_spawn) {
      leadAgentIds.push(agentId);
    }
  }

  upsertAgentEntries(config, entries);
  if (leadAgentIds.length > 0) {
    addToAllowlist(config, leadAgentIds);
  }

  await writeOpenClawConfig(configPath, config);
}

/** Same as installTeam but skips openclaw.json patching — for CI and Claude Code environments */
export async function installTeamWorkspacesOnly(params: InstallTeamParams): Promise<void> {
  if (params.dryRun) {
    throw new Error("Use planInstallTeam for dry-run");
  }

  const allMembers = params.agents.map((a) => ({
    member: a.member,
    agent: a.agentDef,
  }));

  // Provision each agent (workspace files only, no config patch)
  for (const agent of params.agents) {
    await provisionAgent({
      agentDef: agent.agentDef,
      teamDef: params.teamDef,
      member: agent.member,
      allMembers,
      workspaceDir: agent.workspaceDir,
      agentDir: agent.agentDir,
      createAgentDir: false,
      overwrite: params.overwrite,
    });
  }
  // No openclaw.json patch, no allowlist update
}

/** Produce a dry-run plan without making changes */
export function planInstallTeam(params: InstallTeamParams): InstallAction[] {
  const actions: InstallAction[] = [];
  const allMembers = params.agents.map((a) => ({
    member: a.member,
    agent: a.agentDef,
  }));

  for (const agent of params.agents) {
    actions.push({
      type: "create_workspace",
      path: agent.workspaceDir,
      description: `Create workspace dir for ${agent.agentDef.name}`,
    });
    if (!params.skipOpenClaw) {
      actions.push({
        type: "create_agent_dir",
        path: agent.agentDir,
        description: `Create agent dir for ${agent.agentDef.name}`,
      });
    }

    const files = renderBootstrapFiles(
      agent.agentDef,
      params.teamDef,
      agent.member,
      allMembers,
    );
    for (const fileName of Object.keys(files)) {
      actions.push({
        type: "write_file",
        path: `${agent.workspaceDir}/${fileName}`,
        description: `Write ${fileName} for ${agent.agentDef.name}`,
      });
    }
  }

  if (!params.skipOpenClaw) {
    actions.push({
      type: "patch_config",
      path: resolveOpenClawConfigPath(),
      description: `Patch openclaw.json: add ${params.agents.length} agents to list`,
    });

    actions.push({
      type: "update_guidance",
      path: resolveMainAgentWorkspaceDir(),
      description: "Update TOOLS.md and AGENTS.md with store guidance",
    });
  }

  return actions;
}

// ── Uninstall a team ─────────────────────────────────────────────────────────

export async function uninstallTeam(
  projectId: string,
  teamId: string,
  workspaceRoot: string,
  agentIds: string[] = [],
): Promise<void> {
  const { path: configPath, config } = await readOpenClawConfig();

  const removed = removeTeamAgentEntries(config, projectId, teamId, agentIds);
  const removedIds = removed
    .map((e) => (typeof e.id === "string" ? e.id : ""))
    .filter(Boolean);

  removeFromAllowlist(config, removedIds);
  await writeOpenClawConfig(configPath, config);

  // Remove workspace
  try {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  } catch {
    // already gone
  }

  // Remove agent dirs
  for (const entry of removed) {
    const agentDir = typeof entry.agentDir === "string" ? entry.agentDir : "";
    if (!agentDir) continue;
    const parentDir = path.dirname(agentDir);
    try {
      await fs.rm(parentDir, { recursive: true, force: true });
    } catch {
      // already gone
    }
  }
}
