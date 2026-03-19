import fs from "node:fs/promises";
import path from "node:path";
import { readOpenClawConfig, type OpenClawConfig } from "./adapters/openclaw.js";
import { resolveMainAgentWorkspaceDir, resolveOpenClawStateDir } from "./paths.js";

export type OpenClawAgentSource = "store-managed" | "openclaw-native" | "project-attached";

export type OpenClawAgentRecord = {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  skills?: string[];
  source: OpenClawAgentSource;
  projectId?: string;
  teamId?: string;
};

function parseStoreManagedAgentId(agentId: string): { projectId?: string; teamId?: string } {
  const parts = agentId.split("__");
  if (parts.length >= 4 && parts[0] === "store") {
    return {
      projectId: parts[1],
      teamId: parts[2],
    };
  }
  return {};
}

function normalizeSkills(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const skills = value.filter((entry): entry is string => typeof entry === "string");
  return skills.length > 0 ? skills : [];
}

export function listAgentsFromConfig(config: OpenClawConfig): OpenClawAgentRecord[] {
  const list = Array.isArray(config.agents?.list) ? config.agents.list : [];
  const records: OpenClawAgentRecord[] = [];
  for (const entry of list) {
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) continue;
    const { projectId, teamId } = parseStoreManagedAgentId(id);
    records.push({
      id,
      name: typeof entry.name === "string" ? entry.name : undefined,
      workspace: typeof entry.workspace === "string" ? entry.workspace : undefined,
      agentDir: typeof entry.agentDir === "string" ? entry.agentDir : undefined,
      skills: normalizeSkills(entry.skills),
      source: projectId ? "store-managed" : "openclaw-native",
      projectId,
      teamId,
    });
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listOpenClawAgents(): Promise<OpenClawAgentRecord[]> {
  try {
    const { config } = await readOpenClawConfig();
    const records = listAgentsFromConfig(config);
    const existingIds = new Set(records.map((record) => record.id));
    const mainAgentDir = path.join(resolveOpenClawStateDir(), "agents", "main", "agent");

    try {
      await fs.access(mainAgentDir);
      if (!existingIds.has("main")) {
        records.push({
          id: "main",
          name: "Main",
          workspace: typeof config.agents?.defaults?.workspace === "string"
            ? config.agents.defaults.workspace
            : resolveMainAgentWorkspaceDir(),
          agentDir: mainAgentDir,
          source: "openclaw-native",
        });
      }
    } catch {
      // no implicit main agent found on disk
    }

    return records.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export async function resolveOpenClawAgentsById(agentIds: string[]): Promise<OpenClawAgentRecord[]> {
  if (agentIds.length === 0) return [];
  const wanted = new Set(agentIds);
  const records = await listOpenClawAgents();
  return records.filter((record) => wanted.has(record.id));
}
