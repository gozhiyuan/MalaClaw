import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const FailureClass = z.enum([
  "deterministic_contract",
  "llm_contract",
  "evidence_quality",
  "external_environment",
  "operator_state",
  "unknown",
]);
export type FailureClass = z.infer<typeof FailureClass>;

export const FlowFailure = z.object({
  version: z.literal(1),
  ts: z.string().datetime(),
  stage: z.string().min(1),
  attempt: z.number().int().positive().optional(),
  failure_class: FailureClass,
  code: z.string().min(1),
  message: z.string().min(1),
  remediation: z.string().min(1),
  recoverable: z.boolean(),
}).strict();
export type FlowFailure = z.infer<typeof FlowFailure>;

export async function appendFlowFailure(
  workspaceDir: string,
  failure: Omit<FlowFailure, "version" | "ts">,
): Promise<FlowFailure> {
  const record = FlowFailure.parse({ version: 1, ts: new Date().toISOString(), ...failure });
  const target = path.join(workspaceDir, "reports", "failures.ndjson");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, `${JSON.stringify(record)}\n`, "utf-8");
  return record;
}

export async function readFlowFailures(workspaceDir: string): Promise<FlowFailure[]> {
  const target = path.join(workspaceDir, "reports", "failures.ndjson");
  let raw: string;
  try { raw = await fs.readFile(target, "utf-8"); } catch { return []; }
  return raw.split("\n").filter(Boolean).map((line) => FlowFailure.parse(JSON.parse(line)));
}

export function validationFailureClass(runtime: string, findings: string[]): FailureClass {
  const joined = findings.join("\n").toLowerCase();
  const malformed = /(missing|invalid|parse|schema|required_output|not produced|empty|stale_attempt_output|exited with code|timed out|failed to start)/.test(joined);
  if (malformed) return runtime === "script" ? "deterministic_contract" : "llm_contract";
  return "evidence_quality";
}

export function runtimeFailureClass(outcome: string): FailureClass {
  if (["quota_exhausted", "permission_blocked", "tool_missing", "model_unavailable", "budget_exceeded", "rate_limited", "timeout"].includes(outcome)) {
    return "external_environment";
  }
  if (outcome === "cancelled") return "operator_state";
  return "unknown";
}
