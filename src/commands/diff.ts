import { loadManifest, loadLockfile } from "../lib/loader.js";
import { resolveManifest } from "../lib/resolver.js";

type DiffEntry = {
  type: "added" | "removed" | "changed" | "unchanged";
  kind: "agent" | "skill";
  id: string;
  detail?: string;
};

export async function runDiff(projectDir?: string): Promise<void> {
  const manifest = await loadManifest(projectDir);
  const existing = await loadLockfile(projectDir);

  if (!existing) {
    console.log("No lockfile. Run: openclaw-store install");
    return;
  }

  const { packs: newPacks, skills: newSkills } = await resolveManifest(manifest);

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
    }
  }
  for (const id of existingSkillMap.keys()) {
    if (!newSkillIds.has(id)) {
      diffs.push({ type: "removed", kind: "skill", id });
    }
  }

  const added = diffs.filter((d) => d.type === "added");
  const removed = diffs.filter((d) => d.type === "removed");
  const changed = diffs.filter((d) => d.type === "changed");

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log("✓ No changes. Lockfile is up to date.");
    return;
  }

  if (added.length > 0) {
    console.log("\n+ Added:");
    for (const d of added) console.log(`  + [${d.kind}] ${d.id}`);
  }
  if (removed.length > 0) {
    console.log("\n- Removed:");
    for (const d of removed) console.log(`  - [${d.kind}] ${d.id}`);
  }
  if (changed.length > 0) {
    console.log("\n~ Changed:");
    for (const d of changed) console.log(`  ~ [${d.kind}] ${d.id}  ${d.detail ?? ""}`);
  }
  console.log(`\nRun: openclaw-store install to apply these changes.`);
}
