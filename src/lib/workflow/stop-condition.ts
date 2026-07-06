import fs from "node:fs/promises";
import path from "node:path";

export type StopCondition = {
  metric: string;
  op: ">=" | ">" | "<=" | "<" | "==";
  threshold: number;
};

const EXPRESSION = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/;

/** `stop_when` grammar: `<metric> <op> <number>`. Returns null for anything
 *  else — semantic validation rejects unparseable expressions up front. */
export function parseStopCondition(expression: string): StopCondition | null {
  const match = EXPRESSION.exec(expression);
  if (!match) return null;
  return {
    metric: match[1],
    op: match[2] as StopCondition["op"],
    threshold: Number(match[3]),
  };
}

export type StopEvaluation = {
  met: boolean;
  current?: number;
};

/** Evaluate a stop condition against `reports/metrics.json` — a flat JSON
 *  object of numeric metrics written by whichever stage measures quality.
 *  A missing file, metric, or non-numeric value means NOT met (the loop
 *  keeps going until its round cap). */
export async function evaluateStopCondition(
  workspaceDir: string,
  expression: string,
): Promise<StopEvaluation> {
  const condition = parseStopCondition(expression);
  if (!condition) return { met: false };

  let metrics: Record<string, unknown>;
  try {
    const raw = await fs.readFile(path.join(workspaceDir, "reports", "metrics.json"), "utf-8");
    metrics = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { met: false };
  }

  const value = metrics[condition.metric];
  if (typeof value !== "number" || Number.isNaN(value)) return { met: false };

  const met =
    condition.op === ">=" ? value >= condition.threshold :
    condition.op === ">" ? value > condition.threshold :
    condition.op === "<=" ? value <= condition.threshold :
    condition.op === "<" ? value < condition.threshold :
    value === condition.threshold;

  return { met, current: value };
}
