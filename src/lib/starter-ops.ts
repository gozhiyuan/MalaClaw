import fs from "node:fs/promises";
import path from "node:path";
import { loadDemoProject, loadStarter, writeManifest } from "./loader.js";
import { resolveDemoProjectCardPath } from "./paths.js";
import { defaultProjectId, defaultProjectName } from "./project-meta.js";
import type { StarterDef } from "./schema.js";

export type { StarterDef };

export type InitResult = {
  projectDir: string;
  manifestPath: string;
  starterId: string;
  filesCreated: string[];
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function tokenize(input: string): string[] {
  return input.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function starterScore(starter: StarterDef, query: string): number {
  const q = tokenize(query);
  if (q.length === 0) return 0;
  const hay = [
    starter.id,
    starter.name,
    starter.description,
    starter.entry_team,
    ...starter.tags,
    ...starter.packs,
    ...starter.installable_skills,
    ...starter.required_apis,
    ...starter.required_capabilities,
    ...starter.external_requirements,
  ].join(" ").toLowerCase();

  let score = 0;
  for (const token of q) {
    if (starter.id.includes(token)) score += 4;
    if (starter.name.toLowerCase().includes(token)) score += 3;
    if (hay.includes(token)) score += 1;
  }
  return score;
}

export function buildStarterManifest(starter: StarterDef, targetDir: string) {
  const projectId = defaultProjectId(targetDir);
  const projectName = defaultProjectName(targetDir);
  const skills = starter.project_skills.map((id) => ({
    id,
    targets: id === "malaclaw-cook"
      ? { teams: [starter.entry_team] }
      : undefined,
  }));

  return {
    version: 1 as const,
    runtime: "openclaw" as const,
    project: {
      id: projectId,
      name: projectName,
      starter: starter.id,
      entry_team: starter.entry_team,
      description: starter.description,
    },
    packs: starter.packs.map((id) => ({ id })),
    skills,
  };
}

export function buildStarterReadme(starter: StarterDef, targetDir: string): string {
  const projectName = defaultProjectName(targetDir);
  const lines = [
    `# Starter: ${starter.name}`,
    "",
    `This project was initialized from the \`${starter.id}\` starter in malaclaw.`,
    "",
    `## Project`,
    "",
    `- Name: ${projectName}`,
    `- Starter: ${starter.id}`,
    `- Entry Team: ${starter.entry_team}`,
    `- Packs: ${starter.packs.join(", ") || "—"}`,
    `- Project Skills: ${starter.project_skills.join(", ") || "—"}`,
    `- Installable OpenClaw Skills: ${starter.installable_skills.join(", ") || "—"}`,
    `- Required APIs / Services: ${starter.required_apis.join(", ") || "—"}`,
    `- Required Capabilities / Tools: ${starter.required_capabilities.join(", ") || "—"}`,
    "",
    `## Source Use Case`,
    "",
    `- Title: ${starter.source_usecase}`,
  ];

  lines.push("", "## Description", "", starter.description);

  if (starter.installable_skills.length > 0) {
    lines.push("", "## Installable OpenClaw Skills", "");
    for (const skill of starter.installable_skills) {
      lines.push(`- ${skill}`);
    }
  }

  if (starter.required_apis.length > 0) {
    lines.push("", "## Required APIs / Services", "");
    for (const api of starter.required_apis) {
      lines.push(`- ${api}`);
    }
  }

  if (starter.required_capabilities.length > 0) {
    lines.push("", "## Required Capabilities / Tools", "");
    for (const capability of starter.required_capabilities) {
      lines.push(`- ${capability}`);
    }
  }

  if (starter.external_requirements.length > 0) {
    lines.push("", "## Requirement Summary", "");
    for (const req of starter.external_requirements) {
      lines.push(`- ${req}`);
    }
  }

  if (starter.bootstrap_prompt) {
    lines.push("", "## Bootstrap Prompt", "", "```text", starter.bootstrap_prompt, "```");
  }

  lines.push(
    "",
    "## Next Steps",
    "",
    "1. Review `malaclaw.yaml`.",
    "2. Run `malaclaw install --dry-run`.",
    "3. Run `malaclaw install`.",
    "4. Open the project entry-point agent in OpenClaw.",
    "",
  );

  return lines.join("\n");
}

export function suggestStarters(query: string, starters: StarterDef[]): StarterDef[] {
  return starters
    .map((starter) => ({ starter, score: starterScore(starter, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.starter.id.localeCompare(b.starter.id))
    .map((x) => x.starter);
}

export async function initStarter(
  starterId: string,
  targetDir: string,
  opts?: { projectName?: string; force?: boolean },
): Promise<InitResult> {
  const starter = await loadStarter(starterId);

  const absTarget = path.resolve(targetDir);
  const manifestPath = path.join(absTarget, "malaclaw.yaml");
  const starterReadmePath = path.join(absTarget, "STARTER.md");
  const demoProjectPath = path.join(absTarget, "DEMO_PROJECT.md");

  if (
    !opts?.force
    && ((await pathExists(manifestPath))
      || (await pathExists(starterReadmePath))
      || (await pathExists(demoProjectPath)))
  ) {
    throw new Error(
      `Target directory already contains starter files. Re-run with force: true to overwrite.`,
    );
  }

  await fs.mkdir(absTarget, { recursive: true });

  const manifest = buildStarterManifest(starter, absTarget);
  await writeManifest(manifest, absTarget);
  await fs.writeFile(starterReadmePath, buildStarterReadme(starter, absTarget), "utf-8");

  const filesCreated: string[] = [manifestPath, starterReadmePath];

  const demo = await loadDemoProject(starter.id).catch(() => null);
  if (demo) {
    await fs.copyFile(resolveDemoProjectCardPath(demo.card_path), demoProjectPath);
    filesCreated.push(demoProjectPath);
  }

  return {
    projectDir: absTarget,
    manifestPath,
    starterId: starter.id,
    filesCreated,
  };
}
