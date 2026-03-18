import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeProvisioner, RuntimeObserver, InstallTeamParams, InstallAction } from "./base.js";
import type { AgentTelemetry, RuntimeTarget } from "../schema.js";
import { writeAgentTelemetry, readAllAgentTelemetry } from "../telemetry.js";
import { resolveClawTeamDataDir } from "../paths.js";
import { renderBootstrapFiles } from "../renderer.js";

/* ── ClawTeam State Reading ─────────────────────────── */

interface ClawTeamMember {
  name: string;
  user?: string;
  agentId: string;
  agentType?: string;
  joinedAt?: string;
}

interface ClawTeamConfig {
  name: string;
  description?: string;
  leadAgentId?: string;
  createdAt?: string;
  members: ClawTeamMember[];
  budgetCents?: number;
}

interface ClawTeamSpawnEntry {
  backend: string;
  tmux_target?: string;
  pid?: number;
  command?: string[];
}

interface ClawTeamTask {
  id: string;
  subject: string;
  description?: string;
  status: string;
  owner?: string;
  lockedBy?: string;
  blockedBy?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ClawTeamState {
  team: ClawTeamConfig;
  members: ClawTeamMember[];
  spawnRegistry: Record<string, ClawTeamSpawnEntry>;
  tasks: ClawTeamTask[];
}

/** Read ClawTeam's native state for a given team. Returns null if not found. */
export async function readClawTeamState(teamName: string): Promise<ClawTeamState | null> {
  const dataDir = resolveClawTeamDataDir();
  const teamDir = path.join(dataDir, "teams", teamName);

  let config: ClawTeamConfig;
  try {
    config = JSON.parse(await fs.readFile(path.join(teamDir, "config.json"), "utf-8"));
  } catch {
    return null;
  }

  let spawnRegistry: Record<string, ClawTeamSpawnEntry> = {};
  try {
    spawnRegistry = JSON.parse(await fs.readFile(path.join(teamDir, "spawn_registry.json"), "utf-8"));
  } catch {
    // No spawn registry
  }

  const tasks: ClawTeamTask[] = [];
  const taskDir = path.join(dataDir, "tasks", teamName);
  try {
    const taskFiles = await fs.readdir(taskDir);
    for (const f of taskFiles) {
      if (!f.startsWith("task-") || !f.endsWith(".json")) continue;
      try {
        const task = JSON.parse(await fs.readFile(path.join(taskDir, f), "utf-8"));
        tasks.push(task);
      } catch {
        // skip malformed
      }
    }
  } catch {
    // no tasks dir
  }

  return {
    team: config,
    members: config.members || [],
    spawnRegistry,
    tasks,
  };
}

function inferAgentStatus(
  agentName: string,
  spawnRegistry: Record<string, ClawTeamSpawnEntry>,
  tasks: ClawTeamTask[],
): "idle" | "working" | "offline" {
  const activeTasks = tasks.filter(
    (t) => t.owner === agentName && t.status === "in_progress"
  );
  if (activeTasks.length > 0) return "working";
  const spawn = spawnRegistry[agentName];
  if (!spawn?.pid) return "offline";
  return "idle";
}

/* ── ClawTeam Observer ──────────────────────────────── */

export class ClawTeamObserver implements RuntimeObserver {
  readonly runtime: RuntimeTarget;

  constructor(runtime: RuntimeTarget) {
    this.runtime = runtime;
  }

  async start(_onEvent?: (event: { type: string; data: unknown }) => void): Promise<void> {
    await this.syncAllTeams();
  }

  async stop(): Promise<void> {}

  async getAgentStatuses(): Promise<AgentTelemetry[]> {
    const all = await readAllAgentTelemetry();
    return all.filter((a) => a.source === "clawteam");
  }

  async syncTeamState(teamName: string): Promise<void> {
    const state = await readClawTeamState(teamName);
    if (!state) return;

    for (const member of state.members) {
      const status = inferAgentStatus(member.name, state.spawnRegistry, state.tasks);
      const activeTasks = state.tasks.filter(
        (t) => t.owner === member.name && t.status === "in_progress"
      );
      const detail = activeTasks.length > 0
        ? activeTasks.map((t) => t.subject).join("; ")
        : undefined;

      await writeAgentTelemetry({
        agentId: `clawteam__${teamName}__${member.name}`,
        runtime: this.runtime,
        status,
        detail,
        updatedAt: new Date().toISOString(),
        pid: state.spawnRegistry[member.name]?.pid,
        ttlSeconds: 300,
        source: "clawteam",
      });
    }
  }

  private async syncAllTeams(): Promise<void> {
    const dataDir = resolveClawTeamDataDir();
    try {
      const teamsDir = path.join(dataDir, "teams");
      const entries = await fs.readdir(teamsDir);
      for (const teamName of entries) {
        await this.syncTeamState(teamName);
      }
    } catch {
      // ClawTeam not installed
    }
  }
}

/* ── ClawTeam Provisioner ───────────────────────────── */

export class ClawTeamProvisioner implements RuntimeProvisioner {
  readonly runtime = "clawteam" as const;

  async installTeam(params: InstallTeamParams): Promise<void> {
    const exportDir = path.join(params.agents[0]?.workspaceDir ?? ".", "..", ".clawteam-export");
    await fs.mkdir(exportDir, { recursive: true });

    const toml = buildTeamToml(params);
    await fs.writeFile(path.join(exportDir, "team.toml"), toml, "utf-8");

    const catalog = buildSpawnCatalog(params);
    await fs.writeFile(
      path.join(exportDir, "spawn-catalog.json"),
      JSON.stringify(catalog, null, 2) + "\n",
      "utf-8",
    );

    const promptsDir = path.join(exportDir, "prompts");
    await fs.mkdir(promptsDir, { recursive: true });
    for (const agent of params.agents) {
      const allMembers = params.agents.map((a) => ({ member: a.member, agent: a.agentDef }));
      const files = renderBootstrapFiles(agent.agentDef, params.teamDef, agent.member, allMembers);
      const agentPromptDir = path.join(promptsDir, agent.agentDef.id);
      await fs.mkdir(agentPromptDir, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        await fs.writeFile(path.join(agentPromptDir, name), content, "utf-8");
      }
    }
  }

  async uninstallTeam(_projectId: string, _teamId: string, workspaceRoot: string): Promise<void> {
    const exportDir = path.join(workspaceRoot, ".clawteam-export");
    await fs.rm(exportDir, { recursive: true, force: true });
  }

  async planInstallTeam(params: InstallTeamParams): Promise<InstallAction[]> {
    const exportDir = path.join(params.agents[0]?.workspaceDir ?? ".", "..", ".clawteam-export");
    const actions: InstallAction[] = [
      { type: "export_template", path: path.join(exportDir, "team.toml"), description: "Generate ClawTeam team template" },
      { type: "export_template", path: path.join(exportDir, "spawn-catalog.json"), description: "Generate spawn role catalog" },
    ];
    for (const agent of params.agents) {
      actions.push({
        type: "write_file",
        path: path.join(exportDir, "prompts", agent.agentDef.id),
        description: `Generate prompt files for ${agent.agentDef.id}`,
      });
    }
    return actions;
  }
}

/* ── TOML / Catalog Generators ──────────────────────── */

function buildTeamToml(params: InstallTeamParams): string {
  const { teamDef, agents } = params;
  const leader = agents.find((a) => a.member.role === "lead") ?? agents[0];
  const workers = agents.filter((a) => a !== leader);

  const lines: string[] = [];
  lines.push("[template]");
  lines.push(`name = "${teamDef.id}"`);
  if (teamDef.name) lines.push(`description = "${teamDef.name}"`);
  lines.push(`command = ["claude"]`);
  lines.push(`backend = "tmux"`);
  lines.push("");

  lines.push("[template.leader]");
  lines.push(`name = "${leader.agentDef.id}"`);
  lines.push(`type = "${leader.member.role}"`);
  lines.push(`task = """`);
  lines.push(`You are ${leader.agentDef.name ?? leader.agentDef.id}, the team lead.`);
  lines.push(`${leader.agentDef.soul.persona}`);
  lines.push(`"""`);
  lines.push("");

  for (const worker of workers) {
    lines.push("[[template.agents]]");
    lines.push(`name = "${worker.agentDef.id}"`);
    lines.push(`type = "${worker.member.role}"`);
    lines.push(`task = """`);
    lines.push(`You are ${worker.agentDef.name ?? worker.agentDef.id}.`);
    lines.push(`${worker.agentDef.soul.persona}`);
    lines.push(`"""`);
    lines.push("");
  }

  return lines.join("\n");
}

interface SpawnCatalogEntry {
  role: string;
  agentId: string;
  name: string;
  runtime: string;
  promptDir: string;
  model: string;
  capabilities: Record<string, boolean>;
}

function buildSpawnCatalog(params: InstallTeamParams): { version: number; team: string; roles: SpawnCatalogEntry[] } {
  return {
    version: 1,
    team: params.teamDef.id,
    roles: params.agents.map((a) => ({
      role: a.member.role,
      agentId: a.agentDef.id,
      name: a.agentDef.name ?? a.agentDef.id,
      runtime: "claude",
      promptDir: `prompts/${a.agentDef.id}`,
      model: a.agentDef.model.primary,
      capabilities: {
        sessions_spawn: a.agentDef.capabilities.coordination.sessions_spawn ?? false,
        sessions_send: a.agentDef.capabilities.coordination.sessions_send ?? false,
      },
    })),
  };
}
