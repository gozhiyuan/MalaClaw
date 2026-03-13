import * as p from "@clack/prompts";
import { loadAllPacks, loadAllSkills, writeManifest } from "../lib/loader.js";
import { resolveManifestPath } from "../lib/paths.js";
import fs from "node:fs/promises";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runInit(projectDir?: string): Promise<void> {
  p.intro("openclaw-store init");

  const manifestPath = resolveManifestPath(projectDir);
  if (await fileExists(manifestPath)) {
    const overwrite = await p.confirm({
      message: "openclaw-store.yaml already exists. Overwrite?",
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.outro("Cancelled.");
      return;
    }
  }

  const packs = await loadAllPacks();
  const skills = await loadAllSkills();

  // Select packs
  const selectedPacks = await p.multiselect({
    message: "Select starter packs to install:",
    options: packs.map((pack) => ({
      value: pack.id,
      label: `${pack.name} — ${pack.description ?? ""}`,
      hint: `v${pack.version}`,
    })),
    required: false,
  });

  if (p.isCancel(selectedPacks)) {
    p.outro("Cancelled.");
    return;
  }

  // Select skills
  const selectedSkills = await p.multiselect({
    message: "Add optional skills (can be added later):",
    options: skills.map((skill) => {
      const envReqs = skill.requires?.env?.filter((e) => e.required).map((e) => e.key) ?? [];
      const hint = envReqs.length > 0 ? `requires: ${envReqs.join(", ")}` : skill.trust_tier;
      return {
        value: skill.id,
        label: skill.name,
        hint,
      };
    }),
    required: false,
  });

  if (p.isCancel(selectedSkills)) {
    p.outro("Cancelled.");
    return;
  }

  const manifest = {
    version: 1 as const,
    packs: (selectedPacks as string[]).map((id) => ({ id })),
    skills: (selectedSkills as string[]).map((id) => ({ id })),
  };

  await writeManifest(manifest, projectDir);

  p.outro(
    `Created openclaw-store.yaml with ${manifest.packs.length} pack(s) and ${manifest.skills.length} skill(s).\n` +
    `Run: openclaw-store install --dry-run   to preview\n` +
    `Run: openclaw-store install             to install`,
  );
}
