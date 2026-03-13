import { loadAllAgents, loadAllTeams, loadAllSkills, loadAllPacks } from "../lib/loader.js";
import { ZodError } from "zod";

type ValidationResult = {
  file: string;
  ok: boolean;
  errors: string[];
};

export async function runValidate(): Promise<void> {
  const results: ValidationResult[] = [];

  const runners: Array<{ label: string; fn: () => Promise<unknown[]> }> = [
    { label: "agents", fn: loadAllAgents },
    { label: "teams", fn: loadAllTeams },
    { label: "skills", fn: loadAllSkills },
    { label: "packs", fn: loadAllPacks },
  ];

  for (const runner of runners) {
    try {
      await runner.fn();
      results.push({ file: runner.label, ok: true, errors: [] });
    } catch (err) {
      const msgs = err instanceof ZodError
        ? err.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`)
        : [err instanceof Error ? err.message : String(err)];
      results.push({ file: runner.label, ok: false, errors: msgs });
    }
  }

  let allOk = true;
  for (const r of results) {
    if (r.ok) {
      console.log(`✓ ${r.file}`);
    } else {
      allOk = false;
      console.log(`✗ ${r.file}`);
      for (const e of r.errors) console.log(`    ${e}`);
    }
  }

  if (!allOk) {
    console.log("\nValidation failed. Fix the errors above.");
    process.exit(1);
  } else {
    console.log("\n✓ All templates valid.");
  }
}
