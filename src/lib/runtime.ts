import fs from "node:fs/promises";
import path from "node:path";
import { RuntimeState, type RuntimeProject } from "./schema.js";
import { resolveStoreRuntimeFile } from "./paths.js";

async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as unknown;
}

export async function loadRuntimeState(): Promise<RuntimeState> {
  const filePath = resolveStoreRuntimeFile();
  try {
    const raw = await readJson(filePath);
    return RuntimeState.parse(raw);
  } catch {
    return { version: 1, projects: [] };
  }
}

export async function writeRuntimeState(state: RuntimeState): Promise<void> {
  const filePath = resolveStoreRuntimeFile();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export async function upsertRuntimeProject(project: RuntimeProject): Promise<void> {
  const state = await loadRuntimeState();
  const projects = state.projects.filter((p) => p.id !== project.id);
  projects.push(project);
  projects.sort((a, b) => a.id.localeCompare(b.id));
  await writeRuntimeState({ ...state, projects });
}

export async function removeRuntimeProject(projectId: string): Promise<void> {
  const state = await loadRuntimeState();
  const projects = state.projects.filter((p) => p.id !== projectId);
  await writeRuntimeState({ ...state, projects });
}
