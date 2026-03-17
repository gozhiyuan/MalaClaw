import fs from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { loadAllStarters, loadDemoProject, loadDemoProjectIndex } from "../lib/loader.js";
import { initStarter, starterScore, suggestStarters } from "../lib/starter-ops.js";
import type { StarterDef } from "../lib/schema.js";

export { initStarter } from "../lib/starter-ops.js";

export async function starterList(search?: string): Promise<void> {
  const starters = await loadAllStarters();
  const demoIndex = await loadDemoProjectIndex();
  const demoMap = new Map(demoIndex.demos.map((demo) => [demo.starter, demo]));
  const filtered = search
    ? starters
      .map((starter) => ({ starter, score: starterScore(starter, search) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.starter.id.localeCompare(b.starter.id))
      .map((x) => x.starter)
    : starters.sort((a, b) => a.id.localeCompare(b.id));

  if (filtered.length === 0) {
    console.log(search ? `No starters matched "${search}".` : "No starters found.");
    return;
  }

  console.log(`\nStarters (${filtered.length}):\n`);
  for (const starter of filtered) {
    const demo = demoMap.get(starter.id);
    console.log(`  ${starter.name} (${starter.id})`);
    console.log(`    entry: ${starter.entry_team}  packs: ${starter.packs.join(", ")}`);
    if (demo) {
      console.log(`    category: ${demo.category}  recommended: ${demo.recommended_mode}`);
    }
    console.log(`    ${starter.description}`);
  }
}

export async function starterShow(starterId: string): Promise<void> {
  let starter: StarterDef;
  try {
    const { loadStarter } = await import("../lib/loader.js");
    starter = await loadStarter(starterId);
  } catch {
    console.error(`Starter "${starterId}" not found.`);
    process.exit(1);
  }
  const demo = await loadDemoProject(starterId).catch(() => null);

  console.log(`\n${starter.name} (${starter.id})\n`);
  console.log(`Description: ${starter.description}`);
  console.log(`Source:      ${starter.source_usecase}`);
  console.log(`Entry team:  ${starter.entry_team}`);
  console.log(`Packs:       ${starter.packs.join(", ") || "—"}`);
  console.log(`Proj skills: ${starter.project_skills.join(", ") || "—"}`);
  console.log(`OC skills:   ${starter.installable_skills.join(", ") || "—"}`);
  console.log(`APIs/svcs:   ${starter.required_apis.join(", ") || "—"}`);
  console.log(`Capabilities:${starter.required_capabilities.length ? ` ${starter.required_capabilities.join(", ")}` : " —"}`);
  if (demo) {
    console.log(`Category:    ${demo.category}`);
    console.log(`Recommended: ${demo.recommended_mode}`);
  }
  if (starter.tags.length > 0) {
    console.log(`Tags:        ${starter.tags.join(", ")}`);
  }

  if (demo) {
    console.log("\nExecution modes:");
    console.log(`  - Default workflow: ${demo.execution.default_workflow}`);
    console.log(`  - Managed workflow: ${demo.execution.managed_workflow}`);
  }

  if (demo?.setup_guidance.length) {
    console.log("\nSetup guidance:");
    for (const step of demo.setup_guidance) {
      console.log(`  - ${step}`);
    }
  }

  if (starter.external_requirements.length > 0) {
    console.log("\nRequirement summary:");
    for (const req of starter.external_requirements) {
      console.log(`  - ${req}`);
    }
  }

  if (starter.bootstrap_prompt) {
    console.log("\nBootstrap prompt:\n");
    console.log(starter.bootstrap_prompt);
  }
}

export async function starterSuggest(query: string): Promise<void> {
  const starters = await loadAllStarters();
  const ranked = suggestStarters(query, starters).slice(0, 5);

  if (ranked.length === 0) {
    console.log(`No close starter matches for "${query}".`);
    return;
  }

  console.log(`\nSuggested starters for "${query}":\n`);
  for (const starter of ranked) {
    console.log(`  ${starter.name} (${starter.id})`);
    console.log(`    entry: ${starter.entry_team}  packs: ${starter.packs.join(", ")}`);
    console.log(`    ${starter.description}`);
  }
}

export async function starterInit(
  starterId: string,
  targetDir: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  let result;
  try {
    result = await initStarter(starterId, targetDir, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found") || message.includes("No such file")) {
      console.error(`Starter "${starterId}" not found.`);
      process.exit(1);
    }
    if (message.includes("already contains starter files")) {
      console.error(`Target directory already contains starter files. Re-run with --force to overwrite.`);
      process.exit(1);
    }
    console.error(message);
    process.exit(1);
  }

  const { loadStarter } = await import("../lib/loader.js");
  const starter = await loadStarter(starterId);
  console.log(`Initialized starter ${result.starterId} in ${result.projectDir}`);
  const { loadManifest } = await import("../lib/loader.js");
  const manifest = await loadManifest(result.projectDir);
  console.log(`Project id: ${manifest.project?.id}`);
  console.log(`Entry team: ${starter.entry_team}`);
  console.log(`Run: openclaw-store install --dry-run`);
}

export async function starterExportIndex(targetPath: string): Promise<void> {
  const starters = await loadAllStarters();
  const absPath = path.resolve(targetPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, stringify(starters), "utf-8");
  console.log(`Wrote starter index: ${absPath}`);
}
