import { loadManifest, loadLockfile } from "./loader.js";
import { resolveManifest } from "./resolver.js";

export type DiffEntry = {
  type: "added" | "removed" | "changed" | "unchanged";
  kind: "agent" | "skill";
  id: string;
  detail?: string;
};

export async function computeDiff(opts?: { projectDir?: string }): Promise<DiffEntry[]> {
  const projectDir = opts?.projectDir;
  const manifest = await loadManifest(projectDir);
  const existing = await loadLockfile(projectDir);

  if (!existing) {
    return [];
  }

  const { packs: newPacks, skills: newSkills } = await resolveManifest(manifest, { projectDir });

  const diffs: DiffEntry[] = [];

  // Compare agents
  const existingAgentIds = new Set(
    (existing.packs ?? []).flatMap((p) => p.agents.map((a) => a.id)),
  );
  const newAgentIds = new Set(newPacks.flatMap((p) => p.agents.map((a) => a.agentId)));

  for (const id of newAgentIds) {
    if (!existingAgentIds.has(id)) {
      diffs.push({ type: "added", kind: "agent", id });
    } else {
      diffs.push({ type: "unchanged", kind: "agent", id });
    }
  }
  for (const id of existingAgentIds) {
    if (!newAgentIds.has(id)) {
      diffs.push({ type: "removed", kind: "agent", id });
    }
  }

  // Compare skills
  const existingSkillMap = new Map(
    (existing.skills ?? []).map((s) => [s.id, s.status]),
  );
  const newSkillIds = new Set(newSkills.map((s) => s.skillDef.id));
  for (const s of newSkills) {
    const prevStatus = existingSkillMap.get(s.skillDef.id);
    if (prevStatus === undefined) {
      diffs.push({ type: "added", kind: "skill", id: s.skillDef.id });
    } else if (prevStatus !== s.status) {
      diffs.push({
        type: "changed",
        kind: "skill",
        id: s.skillDef.id,
        detail: `${prevStatus} → ${s.status}`,
      });
    } else {
      diffs.push({ type: "unchanged", kind: "skill", id: s.skillDef.id });
    }
  }
  for (const id of existingSkillMap.keys()) {
    if (!newSkillIds.has(id)) {
      diffs.push({ type: "removed", kind: "skill", id });
    }
  }

  return diffs;
}
