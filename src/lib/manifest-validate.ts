import fs from "node:fs/promises";
import { ZodError } from "zod";
import { loadManifest } from "./loader.js";
import { resolveManifest } from "./resolver.js";
import { resolveManifestPath } from "./paths.js";

export type ManifestValidation = {
  found: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
};

/** Validate the project's malaclaw.yaml: Zod shape + full resolution
 *  (pack/team/agent loading + workflow semantics). Safe to call when no
 *  manifest exists — returns found=false. */
export async function validateProjectManifest(projectDir?: string): Promise<ManifestValidation> {
  const manifestPath = resolveManifestPath(projectDir);
  try {
    await fs.access(manifestPath);
  } catch {
    return { found: false, ok: true, errors: [], warnings: [] };
  }

  try {
    const manifest = await loadManifest(projectDir);
    const result = await resolveManifest(manifest, { projectDir });
    return { found: true, ok: true, errors: [], warnings: result.workflowWarnings };
  } catch (err) {
    const errors =
      err instanceof ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
        : [err instanceof Error ? err.message : String(err)];
    return { found: true, ok: false, errors, warnings: [] };
  }
}
