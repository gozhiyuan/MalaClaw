// Re-exports and wraps src/lib/ functions for use by route handlers.
// Import paths reference the compiled dist/ output via project references.

import { loadRuntimeState } from "../../../dist/lib/runtime.js";
import {
  loadAllAgents, loadAllTeams, loadAllSkills, loadAllPacks,
  loadAllStarters, loadAgent, loadTeam, loadSkill,
  loadStarter, loadManifest, loadLockfile, writeManifest,
  loadDemoProject,
} from "../../../dist/lib/loader.js";
import { resolveSharedMemoryDir } from "../../../dist/lib/paths.js";
import { runChecks } from "../../../dist/lib/doctor.js";
import { computeDiff } from "../../../dist/lib/diff.js";
import { runHeadlessInstall } from "../../../dist/lib/install-headless.js";
import { checkSkills, syncSkills } from "../../../dist/lib/skill-ops.js";
import { initStarter, suggestStarters } from "../../../dist/lib/starter-ops.js";
import fs from "node:fs/promises";
import path from "node:path";

export const store = {
  // Projects
  getProjects: () => loadRuntimeState(),
  getProject: async (id: string) => {
    const state = await loadRuntimeState();
    const project = state.projects.find((p) => p.id === id);
    if (!project) return null;
    const lockfile = project.project_dir
      ? await loadLockfile(project.project_dir)
      : null;
    return { ...project, lockfile };
  },

  // Kanban (reads shared memory markdown)
  // NOTE: Verify that resolveSharedMemoryDir(projectId, teamId) returns
  // the correct path format. Check src/lib/paths.ts — it expects the
  // store__<project>__<team> scoped workspace path under workspacesRoot.
  getKanban: async (projectId: string, teamId: string) => {
    const dir = resolveSharedMemoryDir(projectId, teamId);
    const filePath = path.join(dir, "kanban.md");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { content, raw: true }; // Frontend parses markdown
    } catch {
      return { content: null, raw: true };
    }
  },

  // Task log
  getTaskLog: async (projectId: string, teamId: string) => {
    const dir = resolveSharedMemoryDir(projectId, teamId);
    const filePath = path.join(dir, "tasks-log.md");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { content, raw: true };
    } catch {
      return { content: null, raw: true };
    }
  },

  // Teams & Agents
  getTeams: () => loadAllTeams(),
  getTeam: (id: string) => loadTeam(id),
  getAgents: () => loadAllAgents(),
  getAgent: (id: string) => loadAgent(id),

  // Skills
  getSkills: () => loadAllSkills(),
  checkSkills: (opts?: { projectDir?: string }) => checkSkills(opts),
  syncSkills: () => syncSkills(),

  // Health
  getHealth: (opts?: { projectDir?: string }) => runChecks(opts),

  // Starters
  getStarters: () => loadAllStarters(),
  getStarter: async (id: string) => {
    const starter = await loadStarter(id);
    let card: string | null = null;
    try {
      const demo = await loadDemoProject(id);
      card = demo.summary ?? null;
    } catch { /* no demo card */ }
    return { ...starter, card };
  },
  initStarter,
  suggestStarters,

  // Manifest
  getManifest: (projectDir?: string) => loadManifest(projectDir),
  updateManifest: async (manifest: unknown, projectDir?: string) => {
    // Validate against Manifest Zod schema before writing
    const { Manifest } = await import("../../../dist/lib/schema.js");
    const validated = Manifest.parse(manifest);
    return writeManifest(validated, projectDir);
  },

  // Diff
  getDiff: (opts?: { projectDir?: string }) => computeDiff(opts),

  // Install
  install: runHeadlessInstall,
};
