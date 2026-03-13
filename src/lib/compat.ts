import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PackDef } from "./schema.js";

const execFileAsync = promisify(execFile);

export type CompatResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
};

/** Read OpenClaw's version via CLI probe. */
export async function readOpenClawVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("openclaw", ["--version"]);
    const match = stdout.match(/(\d{4}\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/);
    return (match?.[1] ?? stdout.trim()) || null;
  } catch {
    return null;
  }
}

function semverGte(a: string, b: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return (aPatch ?? 0) >= (bPatch ?? 0);
}

export async function checkPackCompatibility(packs: PackDef[]): Promise<CompatResult> {
  const result: CompatResult = { ok: true, warnings: [], errors: [] };
  const ocVersion = await readOpenClawVersion();
  const nodeVersion = process.version.replace(/^v/, "");

  for (const pack of packs) {
    const compat = pack.compatibility;
    if (!compat) continue;

    if (compat.node_min && !semverGte(nodeVersion, compat.node_min)) {
      result.errors.push(
        `Pack ${pack.id} requires Node >= ${compat.node_min}, got ${nodeVersion}`,
      );
      result.ok = false;
    }

    if (compat.openclaw_min) {
      if (!ocVersion) {
        result.warnings.push(
          `Pack ${pack.id} requires OpenClaw >= ${compat.openclaw_min} but version could not be detected via CLI probe`,
        );
      } else if (!semverGte(ocVersion, compat.openclaw_min)) {
        result.errors.push(
          `Pack ${pack.id} requires OpenClaw >= ${compat.openclaw_min}, detected ${ocVersion}`,
        );
        result.ok = false;
      }
    }
  }

  return result;
}
