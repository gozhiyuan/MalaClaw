import fs from "node:fs/promises";
import type { StageRunOutcome } from "../../schema.js";
import { resolveWithin } from "../safe-paths.js";

const PATTERNS: Array<[RegExp, StageRunOutcome]> = [
  [/rate.?limit|\b429\b|overloaded/i, "rate_limited"],
  [/quota|credit balance|billing|usage limit/i, "quota_exhausted"],
  [/permission.*(denied|required)|not allowed to use/i, "permission_blocked"],
  [/model.*(not found|unavailable|invalid)/i, "model_unavailable"],
];

/** Map a failing CLI's output to a classified outcome so the engine's
 *  scheduler can back off / pause / fallback deterministically. */
export function classifyCliFailure(text: string): StageRunOutcome {
  for (const [pattern, outcome] of PATTERNS) {
    if (pattern.test(text)) return outcome;
  }
  return "worker_error";
}

/** The contract check: which declared concrete outputs actually exist.
 *  Globs/templates are skipped (validated elsewhere); unsafe paths never pass. */
export async function collectProducedFiles(
  workspaceDir: string,
  outputs: string[],
): Promise<string[]> {
  const produced: string[] = [];
  for (const output of outputs) {
    if (output.includes("*") || output.includes("{{")) continue;
    try {
      await fs.access(resolveWithin(workspaceDir, output));
      produced.push(output);
    } catch {
      // missing or unsafe — not produced
    }
  }
  return produced;
}
