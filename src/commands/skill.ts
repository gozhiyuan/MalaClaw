import { loadSkill, loadAllSkills } from "../lib/loader.js";
import { loadLockfile } from "../lib/loader.js";

export async function skillList(): Promise<void> {
  const skills = await loadAllSkills();
  const lockfile = await loadLockfile();

  const lockedSkills = lockfile?.skills ?? [];
  const lockedById = new Map(lockedSkills.map((s) => [s.id, s]));

  if (skills.length === 0) {
    console.log("No skill templates found.");
    return;
  }

  console.log(`\nSkills (${skills.length}):\n`);
  for (const s of skills) {
    const locked = lockedById.get(s.id);
    const statusStr = locked
      ? locked.status === "active"
        ? " [ACTIVE]"
        : locked.status === "failed"
          ? ` [FAILED — ${locked.install_error ?? "install failed"}]`
          : ` [INACTIVE — missing: ${locked.missing_env?.join(", ")}]`
      : "";
    const tier = s.trust_tier;
    console.log(`  ${s.name.padEnd(28)} (${s.id})  ${tier}${statusStr}`);
  }
}

export async function skillShow(skillId: string): Promise<void> {
  let skillDef;
  try {
    skillDef = await loadSkill(skillId);
  } catch {
    console.error(`Skill "${skillId}" not found.`);
    process.exit(1);
  }

  const lockfile = await loadLockfile();
  const locked = lockfile?.skills?.find((s) => s.id === skillId);

  console.log(`\n${skillDef.name} (${skillDef.id})\n`);
  console.log(`Description: ${skillDef.description ?? "—"}`);
  console.log(`Trust tier:  ${skillDef.trust_tier}`);
  console.log(`Source:      ${skillDef.source.type}${skillDef.source.url ? ` — ${skillDef.source.url}` : ""}`);
  if (skillDef.source.pin) {
    console.log(`Pinned:      v${skillDef.source.pin}`);
  }

  if (locked) {
    const statusStr =
      locked.status === "active"
        ? "✓ ACTIVE"
        : locked.status === "failed"
          ? `✗ FAILED — ${locked.install_error ?? "install failed"}`
          : `⚠ INACTIVE — missing: ${locked.missing_env?.join(", ")}`;
    console.log(`Status:      ${statusStr}`);
  }

  if (skillDef.requires?.env && skillDef.requires.env.length > 0) {
    console.log(`\nEnvironment Variables:`);
    for (const env of skillDef.requires.env) {
      const req = env.required ? "required" : "optional";
      const isSet = process.env[env.key] ? " ✓" : " ✗ not set";
      console.log(`  ${env.key.padEnd(20)} [${req}]${isSet}`);
      console.log(`    ${env.description}`);
      if (env.degradation) {
        console.log(`    Without this: ${env.degradation}`);
      }
    }
  }

  if (skillDef.install_hints && skillDef.install_hints.length > 0) {
    console.log(`\nInstall hints:`);
    for (const h of skillDef.install_hints) {
      console.log(`  → ${h}`);
    }
  }
}

export async function skillCheck(): Promise<void> {
  const lockfile = await loadLockfile();
  if (!lockfile || !lockfile.skills || lockfile.skills.length === 0) {
    console.log("No skills in lockfile. Run: openclaw-store install");
    return;
  }

  let allActive = true;
  console.log("\nSkill status:\n");
  for (const s of lockfile.skills) {
    if (s.status === "active") {
      console.log(`  ✓ [ACTIVE]   ${s.id}`);
    } else if (s.status === "failed") {
      allActive = false;
      console.log(`  ✗ [FAILED]   ${s.id}  error: ${s.install_error ?? "install failed"}`);
    } else {
      allActive = false;
      console.log(`  ✗ [INACTIVE] ${s.id}  missing: ${s.missing_env?.join(", ")}`);
    }
  }

  if (!allActive) {
    console.log("\nFix the missing configuration or unavailable skill sources, then re-run: openclaw-store install");
  }
}
