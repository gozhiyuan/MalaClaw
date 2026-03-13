import fs from "node:fs/promises";
import { loadLockfile, loadManifest } from "../lib/loader.js";
import { readOpenClawConfig } from "../lib/adapters/openclaw.js";
import { resolveOpenClawConfigPath, resolveManifestPath } from "../lib/paths.js";
import type { PackDef } from "../lib/schema.js";

type Finding = {
  severity: "ok" | "warning" | "error";
  message: string;
  fix?: string;
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(autoFix: boolean = false): Promise<void> {
  const findings: Finding[] = [];

  // Check 1: manifest exists
  const manifestPath = resolveManifestPath();
  if (await pathExists(manifestPath)) {
    findings.push({ severity: "ok", message: "openclaw-store.yaml found" });
  } else {
    findings.push({
      severity: "warning",
      message: "openclaw-store.yaml not found in current directory",
      fix: "Run: openclaw-store init",
    });
  }

  // Check 2: openclaw.json accessible
  const configPath = resolveOpenClawConfigPath();
  if (await pathExists(configPath)) {
    findings.push({ severity: "ok", message: `openclaw.json found at ${configPath}` });
  } else {
    findings.push({
      severity: "error",
      message: `openclaw.json not found at ${configPath}`,
      fix: "Ensure OpenClaw is installed and ~/.openclaw/openclaw.json exists",
    });
  }

  // Check 3: lockfile
  const lockfile = await loadLockfile();
  if (!lockfile) {
    findings.push({
      severity: "warning",
      message: "No lockfile found — nothing installed yet",
      fix: "Run: openclaw-store install",
    });
  } else {
    findings.push({
      severity: "ok",
      message: `Lockfile found: ${lockfile.packs?.length ?? 0} pack(s), ${lockfile.skills?.length ?? 0} skill(s)`,
    });
  }

  // Check 4: agent workspaces exist for installed agents
  if (lockfile) {
    for (const pack of lockfile.packs ?? []) {
      for (const agent of pack.agents) {
        if (await pathExists(agent.workspace)) {
          findings.push({ severity: "ok", message: `Workspace OK: ${agent.id}` });
        } else {
          findings.push({
            severity: "error",
            message: `Workspace missing: ${agent.id} → ${agent.workspace}`,
            fix: "Run: openclaw-store install --force",
          });
        }
      }
    }
  }

  // Check 5: agent entries in openclaw.json
  if (lockfile && (await pathExists(configPath))) {
    try {
      const { config } = await readOpenClawConfig();
      const agentList = Array.isArray(config.agents?.list) ? config.agents!.list! : [];
      const registeredIds = new Set(agentList.map((a) => String(a.id)));

      for (const pack of lockfile.packs ?? []) {
        for (const agent of pack.agents) {
          if (registeredIds.has(agent.id)) {
            findings.push({ severity: "ok", message: `openclaw.json: ${agent.id} registered` });
          } else {
            findings.push({
              severity: "error",
              message: `openclaw.json missing agent: ${agent.id}`,
              fix: "Run: openclaw-store install --force",
            });
          }
        }
      }
    } catch (err) {
      findings.push({
        severity: "error",
        message: `Failed to read openclaw.json: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Check 6: inactive skills
  if (lockfile) {
    for (const skill of lockfile.skills ?? []) {
      if (skill.status === "inactive") {
        findings.push({
          severity: "warning",
          message: `[INACTIVE] ${skill.id} — missing env: ${skill.missing_env?.join(", ")}`,
          fix: `Set the required environment variable(s), then re-run: openclaw-store install`,
        });
      } else {
        findings.push({ severity: "ok", message: `Skill active: ${skill.id}` });
      }
    }
  }

  // Check 7: pack compatibility
  if (lockfile) {
    const { checkPackCompatibility } = await import("../lib/compat.js");
    const { loadPack } = await import("../lib/loader.js");
    const installedPackIds = [...new Set((lockfile.packs ?? []).map((p) => p.id.split("__")[0]))];
    const packDefs = await Promise.all(installedPackIds.map((id) =>
      loadPack(id).catch(() => null)
    ));
    const validPacks = packDefs.filter((p): p is PackDef => p !== null);
    const compatResult = await checkPackCompatibility(validPacks);
    for (const e of compatResult.errors) {
      findings.push({ severity: "error", message: e });
    }
    for (const w of compatResult.warnings) {
      findings.push({ severity: "warning", message: w });
    }
    if (compatResult.ok && validPacks.length > 0) {
      findings.push({ severity: "ok", message: "Pack compatibility OK" });
    }
  }

  // Print results
  console.log("\nopenclaww-store doctor\n");
  let hasErrors = false;
  let hasWarnings = false;

  for (const f of findings) {
    const icon = f.severity === "ok" ? "✓" : f.severity === "warning" ? "⚠" : "✗";
    console.log(`  ${icon} ${f.message}`);
    if (f.fix && f.severity !== "ok") {
      console.log(`    → ${f.fix}`);
    }
    if (f.severity === "error") hasErrors = true;
    if (f.severity === "warning") hasWarnings = true;
  }

  console.log("");
  if (hasErrors) {
    console.log("✗ Errors found. Run with --fix or follow the suggestions above.");
    process.exit(1);
  } else if (hasWarnings) {
    console.log("⚠ Warnings found. Check suggestions above.");
  } else {
    console.log("✓ All checks passed.");
  }
}
