import path from "node:path";
import type { Lockfile, ManifestProject } from "./schema.js";

export type ResolvedProjectMeta = {
  id: string;
  name?: string;
  description?: string;
  starter?: string;
  entryTeam?: string;
  projectDir: string;
};

function slugifySegment(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

export function defaultProjectName(projectDir: string = process.cwd()): string {
  return path.basename(path.resolve(projectDir)) || "project";
}

export function defaultProjectId(projectDir: string = process.cwd()): string {
  return slugifySegment(defaultProjectName(projectDir));
}

export function resolveProjectMeta(
  project: ManifestProject | undefined,
  projectDir: string = process.cwd(),
): ResolvedProjectMeta {
  const id = slugifySegment(project?.id ?? defaultProjectId(projectDir));
  const name = project?.name ?? defaultProjectName(projectDir);

  return {
    id,
    name,
    description: project?.description,
    starter: project?.starter,
    entryTeam: project?.entry_team,
    projectDir: path.resolve(projectDir),
  };
}

export function projectMetaFromLockfile(
  lockfile: Lockfile | null,
  projectDir: string = process.cwd(),
): ResolvedProjectMeta {
  if (lockfile?.project) {
    return {
      id: lockfile.project.id,
      name: lockfile.project.name ?? defaultProjectName(projectDir),
      description: lockfile.project.description,
      starter: lockfile.project.starter,
      entryTeam: lockfile.project.entry_team,
      projectDir: path.resolve(lockfile.project.project_dir ?? projectDir),
    };
  }
  return resolveProjectMeta(undefined, projectDir);
}

export function formatProjectLabel(project: Pick<ResolvedProjectMeta, "id" | "name">): string {
  return project.name && project.name !== project.id
    ? `${project.name} (${project.id})`
    : project.id;
}
