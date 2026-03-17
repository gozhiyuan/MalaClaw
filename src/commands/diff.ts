import { loadLockfile } from "../lib/loader.js";
import { computeDiff } from "../lib/diff.js";

export async function runDiff(projectDir?: string): Promise<void> {
  const existing = await loadLockfile(projectDir);

  if (!existing) {
    console.log("No lockfile. Run: openclaw-store install");
    return;
  }

  const diffs = await computeDiff({ projectDir });

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
