import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { StageRunOutcome, type WorkflowDef } from "../schema.js";

export const UnitState = z.object({
  status: z.enum(["pending", "running", "succeeded", "skipped", "failed"]).default("pending"),
  attempts: z.number().int().default(0),
  /** Completed revision rounds (max_rounds/stop_when loops). */
  rounds: z.number().int().default(0),
  lastOutcome: StageRunOutcome.optional(),
  lastError: z.string().optional(),
  retryAt: z.string().datetime().optional(),
  requestedRuntime: z.string().optional(),
  actualRuntime: z.string().optional(),
  requestedModel: z.string().optional(),
  actualModel: z.string().optional(),
  approvalGranted: z.boolean().default(false),
  budgetApproved: z.boolean().default(false),
  skipReason: z.string().optional(),
});
export type UnitState = z.infer<typeof UnitState>;

export const PendingApproval = z.object({
  id: z.string(),
  kind: z.enum(["human", "budget"]).default("human"),
  stageId: z.string(),
  stepId: z.string().optional(),
  itemId: z.string().optional(),
  artifacts: z.array(z.string()).default([]),
});
export type PendingApproval = z.infer<typeof PendingApproval>;

export const FlowState = z.object({
  version: z.number().default(1),
  workflowHash: z.string(),
  status: z.enum([
    "idle",
    "running",
    "paused_for_approval",
    "paused_blocker",
    "completed",
    "failed",
  ]).default("idle"),
  units: z.record(UnitState),
  pendingApprovals: z.array(PendingApproval).default([]),
  /** Attempt-level consumption (all attempts, including failed ones). */
  telemetry: z
    .object({
      recordedTokens: z.number().default(0),
      activeMs: z.number().default(0),
    })
    .default({ recordedTokens: 0, activeMs: 0 }),
  foreachItems: z.record(z.array(z.string())).default({}),
  updatedAt: z.string(),
});
export type FlowState = z.infer<typeof FlowState>;

export function flowDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".malaclaw", "flow");
}
export function promptsDir(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "prompts");
}
export function logsDir(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "logs");
}
export function checkpointsDir(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "checkpoints");
}
function statePath(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "state.json");
}
function eventsPath(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "events.jsonl");
}

/** Stable hash of the workflow definition so a changed manifest is detected.
 *  run_limits are excluded: they are operational guardrails, and raising a
 *  limit to resume a paused run must not force --reset (which would wipe
 *  completed-unit state). */
export function workflowHash(workflow: WorkflowDef): string {
  const { run_limits: _runLimits, ...structural } = workflow;
  return crypto.createHash("sha256").update(JSON.stringify(structural)).digest("hex").slice(0, 16);
}

export async function initFlowState(workflow: WorkflowDef, workspaceDir: string): Promise<FlowState> {
  const units: Record<string, UnitState> = {};
  for (const stage of workflow.stages) {
    units[stage.id] = UnitState.parse({});
  }
  const state: FlowState = FlowState.parse({
    workflowHash: workflowHash(workflow),
    units,
    updatedAt: new Date().toISOString(),
  });
  await saveFlowState(workspaceDir, state);
  return state;
}

export async function saveFlowState(workspaceDir: string, state: FlowState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fs.mkdir(flowDir(workspaceDir), { recursive: true });
  await fs.writeFile(statePath(workspaceDir), JSON.stringify(state, null, 2), "utf-8");
}

/** Missing state = fresh workspace (null). A PRESENT but unparseable state
 *  file is corruption and throws loudly — silently re-initializing wiped a
 *  live flagship run's unit records after a hand-edit introduced nulls. */
export async function loadFlowState(workspaceDir: string): Promise<FlowState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(statePath(workspaceDir), "utf-8");
  } catch {
    return null;
  }
  try {
    return FlowState.parse(JSON.parse(raw));
  } catch (err) {
    throw new Error(
      `Flow state exists but is invalid (${statePath(workspaceDir)}): ` +
      `${err instanceof Error ? err.message.split("\n")[0] : String(err)}. ` +
      "Fix or remove the file explicitly — refusing to silently reinitialize.",
    );
  }
}

export type FlowEvent = {
  ts?: string;
  type: string;
  key?: string;
  [extra: string]: unknown;
};

export async function appendEvent(workspaceDir: string, event: FlowEvent): Promise<void> {
  await fs.mkdir(flowDir(workspaceDir), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  await fs.appendFile(eventsPath(workspaceDir), line + "\n", "utf-8");
}

export async function readEvents(workspaceDir: string): Promise<FlowEvent[]> {
  try {
    const raw = await fs.readFile(eventsPath(workspaceDir), "utf-8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as FlowEvent);
  } catch {
    return [];
  }
}
