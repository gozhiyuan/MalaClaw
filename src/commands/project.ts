import fs from "node:fs/promises";
import path from "node:path";
import { loadLockfile, loadManifest } from "../lib/loader.js";
import { resolveSharedMemoryDir } from "../lib/paths.js";
import { formatProjectLabel, projectMetaFromLockfile, resolveProjectMeta } from "../lib/project-meta.js";
import { loadRuntimeState } from "../lib/runtime.js";

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function projectStatus(projectDir?: string): Promise<void> {
  let manifest = null;
  try {
    manifest = await loadManifest(projectDir);
  } catch {
    manifest = null;
  }

  const lockfile = await loadLockfile(projectDir);
  const project = lockfile
    ? projectMetaFromLockfile(lockfile, projectDir)
    : resolveProjectMeta(manifest?.project, projectDir);

  console.log("\nProject Status\n");
  console.log(`Project: ${formatProjectLabel(project)}`);
  console.log(`Dir:     ${project.projectDir}`);
  if (project.entryTeam) {
    console.log(`Entry:   ${project.entryTeam}`);
  }

  if (!lockfile) {
    console.log("\nNo lockfile found. Run: openclaw-store install");
    return;
  }

  console.log(`\nPacks installed: ${lockfile.packs?.length ?? 0}`);
  console.log(`Skills: ${lockfile.skills?.length ?? 0}`);

  for (const pack of lockfile.packs ?? []) {
    console.log(`\nPack: ${pack.id} (v${pack.version})`);
    if (pack.team_id) {
      console.log(`  Team: ${pack.team_id}`);
    }
    console.log(`  Agents: ${pack.agents.length}`);
    for (const agent of pack.agents) {
      console.log(`    - ${agent.id}`);
    }
  }

  if ((lockfile.skills?.length ?? 0) > 0) {
    const active = lockfile.skills!.filter((s) => s.status === "active");
    const inactive = lockfile.skills!.filter((s) => s.status === "inactive");
    const failed = lockfile.skills!.filter((s) => s.status === "failed");
    if (active.length > 0) {
      console.log(`\nActive skills: ${active.map((s) => s.id).join(", ")}`);
    }
    if (inactive.length > 0) {
      console.log(`Inactive skills: ${inactive.map((s) => s.id).join(", ")}`);
    }
    if (failed.length > 0) {
      console.log(`Failed skills: ${failed.map((s) => s.id).join(", ")}`);
    }
  }
}

export async function projectKanban(teamId: string, projectDir?: string): Promise<void> {
  const lockfile = await loadLockfile(projectDir);
  const project = projectMetaFromLockfile(lockfile, projectDir);
  const kanbanPath = path.join(resolveSharedMemoryDir(project.id, teamId), "kanban.md");
  const content = await readFileOrEmpty(kanbanPath);

  if (!content) {
    console.log(`No kanban board found for project "${project.id}" team "${teamId}".`);
    console.log(`Expected: ${kanbanPath}`);
    return;
  }

  console.log(content);
}

export async function projectList(): Promise<void> {
  const runtime = await loadRuntimeState();
  if (runtime.projects.length === 0) {
    console.log("No installed projects found.");
    return;
  }

  console.log(`\nInstalled projects (${runtime.projects.length}):\n`);
  for (const project of runtime.projects) {
    const label = project.name && project.name !== project.id
      ? `${project.name} (${project.id})`
      : project.id;
    const entry = project.entry_points[0]?.openclaw_agent_id ?? "—";
    console.log(`  ${label}`);
    console.log(`    dir: ${project.project_dir}`);
    console.log(`    entry: ${entry}`);
  }
}

export async function projectShow(projectId: string): Promise<void> {
  const runtime = await loadRuntimeState();
  const project = runtime.projects.find((p) => p.id === projectId);
  if (!project) {
    console.error(`Project "${projectId}" not found in runtime registry.`);
    process.exit(1);
  }

  console.log(`\n${project.name ?? project.id} (${project.id})\n`);
  console.log(`Dir: ${project.project_dir}`);
  if (project.manifest_path) {
    console.log(`Manifest: ${project.manifest_path}`);
  }
  if (project.lockfile_path) {
    console.log(`Lockfile: ${project.lockfile_path}`);
  }
  if (project.starter) {
    console.log(`Starter: ${project.starter}`);
  }

  if (project.entry_points.length > 0) {
    console.log("\nEntry points:");
    for (const entry of project.entry_points) {
      console.log(`  ${entry.team_id} -> ${entry.openclaw_agent_id}`);
    }
  }

  if (project.packs.length > 0) {
    console.log(`\nInstalled packs: ${project.packs.join(", ")}`);
  }
  if (project.skills.length > 0) {
    console.log(`Skills: ${project.skills.join(", ")}`);
  }
}
