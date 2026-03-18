import * as p from "@clack/prompts";
import { loadAllPacks, loadAllSkills, writeManifest } from "../lib/loader.js";
import { resolveManifestPath } from "../lib/paths.js";
import { resolveProjectMeta } from "../lib/project-meta.js";
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
  p.intro("malaclaw init");

  const manifestPath = resolveManifestPath(projectDir);
  if (await fileExists(manifestPath)) {
    const overwrite = await p.confirm({
      message: "malaclaw.yaml already exists. Overwrite?",
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.outro("Cancelled.");
      return;
    }
  }

  const packs = await loadAllPacks();
  const skills = await loadAllSkills();
  const project = resolveProjectMeta(undefined, projectDir);

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
    runtime: "openclaw" as const,
    project: {
      id: project.id,
      name: project.name,
    },
    packs: (selectedPacks as string[]).map((id) => ({ id })),
    skills: (selectedSkills as string[]).map((id) => ({ id })),
  };

  await writeManifest(manifest, projectDir);

  p.outro(
    `Created malaclaw.yaml with ${manifest.packs.length} pack(s) and ${manifest.skills.length} skill(s).\n` +
    `Run: malaclaw install --dry-run   to preview\n` +
    `Run: malaclaw install             to install`,
  );
}
