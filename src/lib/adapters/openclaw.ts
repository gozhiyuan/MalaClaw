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
  resolveOpenClawStateDir,
  resolveMainAgentWorkspaceDir,
  resolveAgentId,
} from "../paths.js";
import { renderBootstrapFiles } from "../renderer.js";
import type { AgentDef, AgentTelemetry, TeamDef, TeamMember } from "../schema.js";
import type { RuntimeProvisioner, RuntimeObserver, InstallTeamParams, InstallAction } from "./base.js";
import { readAllAgentTelemetry } from "../telemetry.js";

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
      throw new Error(
        `OpenClaw config not found at ${configPath}.\n` +
        `Install OpenClaw first, then run: malaclaw install`,
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

function resolvePrimaryModel(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { primary?: unknown }).primary === "string") {
    return (value as { primary: string }).primary;
  }
  return undefined;
}

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

async function discoverImplicitNativeAgentEntries(config: OpenClawConfig): Promise<AgentEntry[]> {
  const existingIds = new Set(
    Array.isArray(config.agents?.list)
      ? config.agents.list
        .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
        .filter(Boolean)
      : [],
  );

  const mainAgentDir = path.join(resolveOpenClawStateDir(), "agents", "main", "agent");
  try {
    await fs.access(mainAgentDir);
  } catch {
    return [];
  }

  if (existingIds.has("main")) {
    return [];
  }

  const model = resolvePrimaryModel(config.agents?.defaults?.model);
  const entry: AgentEntry = {
    id: "main",
    name: "Main",
    workspace: resolveMainWorkspaceDir(config),
    agentDir: mainAgentDir,
  };
  if (model) {
    entry.model = model;
  }
  return [entry];
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

const STORE_BLOCK_START = "<!-- malaclaw -->";
const STORE_BLOCK_END = "<!-- /malaclaw -->";

const TOOLS_BLOCK = `${STORE_BLOCK_START}
# MalaClaw

malaclaw manages projects, agent teams, and skills on top of OpenClaw.

## Quick start

The \`malaclaw-cook\` skill is available in your workspace.
Use it to discover and bootstrap projects:

1. \`malaclaw starter list\` — browse available demo projects
2. \`malaclaw starter suggest "<idea>"\` — find the closest starter
3. \`malaclaw starter init <id> ./my-project\` — scaffold
4. \`malaclaw install\` — provision agents and skills

## CLI reference

- Project status:    \`malaclaw project status\`
- Health check:      \`malaclaw doctor\`
- Team graph:        \`malaclaw team show <id>\`
- Skill status:      \`malaclaw skill check\`

## Coordination

Store-managed agents communicate via shared memory files in:
  ~/.malaclaw/workspaces/store/<project>/<team>/shared/memory/

Never send direct messages to store agents — use memory files.
${STORE_BLOCK_END}
`;

const AGENTS_BLOCK = `${STORE_BLOCK_START}
# MalaClaw — Agent Policy

## Installed Teams
Teams are installed into project-scoped workspaces via malaclaw. Each team has an entry point agent.

## Coordination Rules
- Use memory files for all inter-agent communication
- Leads spawn sub-agents for tasks (sessions_spawn)
- No direct peer messaging (sessions_send = false)
- Check the project's team shared memory dir for task queue and status

## Finding Agents
\`malaclaw agent list\` — lists all installed agents
\`malaclaw project list\` — lists installed projects and entry points
\`malaclaw team show <id>\` — shows team graph and entry point
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

function resolveMainWorkspaceDir(config: OpenClawConfig): string {
  const defaults = config.agents?.defaults as Record<string, unknown> | undefined;
  return (typeof defaults?.workspace === "string" ? defaults.workspace : null)
    ?? resolveMainAgentWorkspaceDir();
}

export async function updateStoreGuidance(): Promise<void> {
  const { config } = await readOpenClawConfig();
  const workspaceDir = resolveMainWorkspaceDir(config);

  const toolsPath = path.join(workspaceDir, "TOOLS.md");
  const agentsPath = path.join(workspaceDir, "AGENTS.md");

  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(toolsPath, upsertBlock(await readFileOrEmpty(toolsPath), TOOLS_BLOCK), "utf-8");
  await fs.writeFile(agentsPath, upsertBlock(await readFileOrEmpty(agentsPath), AGENTS_BLOCK), "utf-8");
}

export async function removeStoreGuidance(): Promise<void> {
  const { config } = await readOpenClawConfig();
  const workspaceDir = resolveMainWorkspaceDir(config);

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

export type { InstallTeamParams, InstallAction };

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

  const implicitNativeEntries = await discoverImplicitNativeAgentEntries(config);
  upsertAgentEntries(config, [...implicitNativeEntries, ...entries]);
  if (leadAgentIds.length > 0) {
    addToAllowlist(config, leadAgentIds);
  }

  await writeOpenClawConfig(configPath, config);
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
    actions.push({
      type: "create_agent_dir",
      path: agent.agentDir,
      description: `Create agent dir for ${agent.agentDef.name}`,
    });

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

  actions.push({
    type: "patch_config",
    path: resolveOpenClawConfigPath(),
    description: `Patch openclaw.json: add ${params.agents.length} agents to list`,
  });

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

// ── RuntimeProvisioner / RuntimeObserver class wrappers ──────────────────────

export class OpenClawProvisioner implements RuntimeProvisioner {
  readonly runtime = "openclaw" as const;

  async installTeam(params: InstallTeamParams): Promise<void> {
    return installTeam(params);
  }

  async uninstallTeam(projectId: string, teamId: string, workspaceRoot: string, agentIds?: string[]): Promise<void> {
    return uninstallTeam(projectId, teamId, workspaceRoot, agentIds);
  }

  async planInstallTeam(params: InstallTeamParams): Promise<InstallAction[]> {
    return planInstallTeam(params);
  }
}

export class OpenClawObserver implements RuntimeObserver {
  readonly runtime = "openclaw" as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ws: any = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onEvent?: (event: { type: string; data: unknown }) => void;

  async start(onEvent?: (event: { type: string; data: unknown }) => void): Promise<void> {
    this.onEvent = onEvent;
    // Don't actually connect in constructor — connection happens lazily via dashboard
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws = null;
  }

  async getAgentStatuses(): Promise<AgentTelemetry[]> {
    return (await readAllAgentTelemetry()).filter((a) => a.runtime === "openclaw");
  }
}
