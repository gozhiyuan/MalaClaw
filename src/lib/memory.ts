import fs from "node:fs/promises";
import path from "node:path";
import type { TeamDef, SharedMemoryFile } from "./schema.js";
import { resolveSharedMemoryDir } from "./paths.js";

/** Seed a shared memory file with ownership header and initial structure */
async function seedMemoryFile(
  dir: string,
  file: SharedMemoryFile,
  teamDef: TeamDef,
): Promise<void> {
  const filePath = path.join(dir, file.path);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Don't overwrite existing files (idempotent)
  try {
    await fs.access(filePath);
    return; // already exists
  } catch {
    // create it
  }

  const header = buildOwnershipHeader(file, teamDef);
  const body = buildInitialBody(file);
  await fs.writeFile(filePath, header + body, "utf-8");
}

function buildOwnershipHeader(file: SharedMemoryFile, teamDef: TeamDef): string {
  const teamName = teamDef.name ?? teamDef.id;
  const lines: string[] = [];

  if (file.access === "single-writer") {
    lines.push(`# ${path.basename(file.path)} — single writer: ${file.writer}`);
    lines.push(`<!-- openclaw-store: access=single-writer writer=${file.writer} team=${teamDef.id} -->`);
    lines.push("");
    lines.push(`> **Access policy:** Only \`${file.writer}\` may modify this file.`);
    lines.push(`> All other ${teamName} members have read-only access.`);
  } else if (file.access === "append-only") {
    const writer = file.writer === "*" ? "all team members" : file.writer;
    lines.push(`# ${path.basename(file.path)} — append-only`);
    lines.push(`<!-- openclaw-store: access=append-only writer=${file.writer} team=${teamDef.id} -->`);
    lines.push("");
    lines.push(`> **Access policy:** ${writer} may append entries. No overwrites or edits.`);
    lines.push(`> Always add new entries at the bottom.`);
  } else if (file.access === "private") {
    lines.push(`# ${path.basename(file.path)} — private: ${file.writer}`);
    lines.push(`<!-- openclaw-store: access=private writer=${file.writer} team=${teamDef.id} -->`);
    lines.push("");
    lines.push(`> **Access policy:** Only \`${file.writer}\` reads and writes this file.`);
  }

  lines.push("");
  return lines.join("\n");
}

function buildInitialBody(file: SharedMemoryFile): string {
  const filename = path.basename(file.path);

  if (filename === "kanban.md") {
    return [
      "## To Do",
      "",
      "## In Progress",
      "",
      "## Done",
      "",
    ].join("\n");
  }

  if (filename === "tasks-log.md") {
    return [
      "## Task Log",
      "",
      "<!-- Agents: append entries below in format: -->",
      "<!-- [YYYY-MM-DD HH:MM] [agent-id] status: message -->",
      "",
    ].join("\n");
  }

  if (filename === "blockers.md") {
    return [
      "## Blockers",
      "",
      "<!-- Agents: append blockers below in format: -->",
      "<!-- [YYYY-MM-DD HH:MM] [agent-id] BLOCKER: description -->",
      "",
    ].join("\n");
  }

  if (filename.includes("brief") || filename === "team-shared.md") {
    return [
      "## Overview",
      "",
      "*(Owner: fill in project context here)*",
      "",
      "## Current Goals",
      "",
      "## Notes",
      "",
    ].join("\n");
  }

  return "*(initialized by openclaw-store)*\n";
}

/** Seed all shared memory files for a team */
export async function seedTeamSharedMemory(teamDef: TeamDef): Promise<void> {
  const files = teamDef.shared_memory?.files ?? [];
  if (files.length === 0) return;

  const dir = resolveSharedMemoryDir(teamDef.id);
  await fs.mkdir(dir, { recursive: true });

  for (const file of files) {
    await seedMemoryFile(dir, file, teamDef);
  }
}

/** Remove all shared memory files for a team */
export async function removeTeamSharedMemory(teamDef: TeamDef): Promise<void> {
  const dir = resolveSharedMemoryDir(teamDef.id);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // already gone
  }
}
