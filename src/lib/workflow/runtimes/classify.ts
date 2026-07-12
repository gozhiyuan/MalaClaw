import fs from "node:fs/promises";
import type { StageRunOutcome } from "../../schema.js";
import { resolveWithin } from "../safe-paths.js";

const PATTERNS: Array<[RegExp, StageRunOutcome]> = [
  [/rate.?limit|\b429\b|overloaded/i, "rate_limited"],
  // "session limit ... resets 2:50am" is Claude's plan-limit phrasing —
  // learned in flagship3, where it burned retries as worker_error.
  [/quota|credit balance|billing|usage limit|session limit|limit reached.*resets|hit your.*limit/i, "quota_exhausted"],
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

/** Parse common harness messages such as "try again at 8:04 PM" and
 * "session limit resets 2:50am". A date-less provider clock is interpreted
 * locally and moved to tomorrow when today's occurrence has passed. */
export function quotaRetryAfterMs(text: string, now = new Date()): number | undefined {
  const match = text.match(/(?:try again|resets?(?:\s+at)?|reset(?:\s+at)?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return undefined;
  const hour12 = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3].toLowerCase();
  if (hour12 < 1 || hour12 > 12 || minute > 59) return undefined;
  const reset = new Date(now);
  reset.setHours((hour12 % 12) + (meridiem === "pm" ? 12 : 0), minute, 0, 0);
  if (reset.getTime() <= now.getTime() + 30_000) reset.setDate(reset.getDate() + 1);
  const delay = reset.getTime() - now.getTime();
  return delay > 0 && delay <= 26 * 60 * 60_000 ? delay : undefined;
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
