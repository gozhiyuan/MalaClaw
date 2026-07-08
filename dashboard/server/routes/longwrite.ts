import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadFlowState } from "../../../dist/lib/workflow/state.js";
import { summarizeUsage } from "../../../dist/commands/flow.js";

type YamlRecord = Record<string, unknown>;

type StageSummary = {
  id: string;
  title?: string;
  type: "standard" | "foreach";
  owner?: string;
  runtime?: string;
  model?: string;
  modelTier?: string;
  requiresHumanApproval: boolean;
  maxParallel?: number;
  steps: Array<{ id: string; owner?: string; runtime?: string; model?: string; modelTier?: string }>;
  outputs: string[];
};

async function readTextIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

async function readYamlIfExists(absPath: string): Promise<YamlRecord | null> {
  const raw = await readTextIfExists(absPath);
  if (raw === null) return null;
  const parsed = parseYaml(raw);
  return typeof parsed === "object" && parsed !== null ? (parsed as YamlRecord) : {};
}

function requireDir(dir: unknown): string {
  if (typeof dir !== "string" || dir.length === 0 || !path.isAbsolute(dir)) {
    throw Object.assign(new Error("dir must be an absolute workspace path"), { statusCode: 400 });
  }
  return dir;
}

function asRecord(value: unknown): YamlRecord {
  return typeof value === "object" && value !== null ? (value as YamlRecord) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stageOutputs(stage: YamlRecord): string[] {
  const outputs = asStringArray(stage.outputs);
  const steps = Array.isArray(stage.steps) ? stage.steps.map(asRecord) : [];
  return [...new Set([...outputs, ...steps.flatMap((step) => asStringArray(step.outputs))])];
}

function summarizeStage(stage: YamlRecord): StageSummary {
  const steps = Array.isArray(stage.steps)
    ? stage.steps.map(asRecord).map((step) => ({
        id: asString(step.id) ?? "unknown",
        owner: asString(step.owner),
        runtime: asString(step.runtime),
        model: asString(step.model),
        modelTier: asString(step.model_tier),
      }))
    : [];
  return {
    id: asString(stage.id) ?? "unknown",
    title: asString(stage.title),
    type: steps.length > 0 || asString(stage.type) === "foreach" ? "foreach" : "standard",
    owner: asString(stage.owner),
    runtime: asString(stage.runtime),
    model: asString(stage.model),
    modelTier: asString(stage.model_tier),
    requiresHumanApproval: asBoolean(stage.requires_human_approval),
    maxParallel: asNumber(stage.max_parallel),
    steps,
    outputs: stageOutputs(stage),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runCommand(workspaceDir: string, runtime?: string): string {
  return `longwrite run ${shellQuote(workspaceDir)}${runtime ? ` --runtime ${shellQuote(runtime)}` : ""}`;
}

function approveCommand(workspaceDir: string, batchApprovals: boolean): string {
  return batchApprovals ? `longwrite approve ${shellQuote(workspaceDir)} --batch` : `longwrite status ${shellQuote(workspaceDir)}`;
}

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/longwrite", async (req, reply) => {
    const workspaceDir = requireDir((req.query as { dir?: string }).dir);
    const longwrite = await readYamlIfExists(path.join(workspaceDir, "longwrite.yaml"));
    if (!longwrite) return reply.status(404).send({ error: "longwrite.yaml not found" });

    const manifest = await readYamlIfExists(path.join(workspaceDir, "malaclaw.yaml"));
    const project = asRecord(longwrite.project);
    const research = asRecord(longwrite.research);
    const review = asRecord(longwrite.review);
    const workflow = asRecord(manifest?.workflow);
    const stages = Array.isArray(workflow.stages) ? workflow.stages.map(asRecord).map(summarizeStage) : [];
    const runtime = asString(manifest?.runtime) ?? asString(asRecord(workflow.runtime_policy).primary);
    const batchApprovals = review.batch_approvals === true;

    let flow = null;
    let usage = null;
    try {
      flow = await loadFlowState(workspaceDir);
      usage = await summarizeUsage(workspaceDir);
    } catch {
      flow = null;
      usage = null;
    }

    return {
      dir: workspaceDir,
      project: {
        id: asString(project.id),
        name: asString(project.name),
        mode: asString(project.mode) ?? asString(workflow.mode),
        artifactType: asString(project.artifact_type) ?? asString(workflow.artifact_type),
      },
      research: {
        topic: asString(research.topic),
        provider: asString(research.provider),
      },
      review: {
        cadence: asString(review.cadence) ?? "manual",
        time: asString(review.time),
        intervalHours: asNumber(review.interval_hours),
        batchApprovals,
      },
      workflow: {
        runtime,
        budgetUsd: asNumber(workflow.budget_usd),
        runtimePolicy: asRecord(workflow.runtime_policy),
        modelTiers: asRecord(workflow.model_tiers),
        stages,
      },
      flow,
      usage,
      commands: {
        status: `longwrite status ${shellQuote(workspaceDir)}`,
        run: runCommand(workspaceDir, runtime),
        approve: approveCommand(workspaceDir, batchApprovals),
        packet: `longwrite report packet ${shellQuote(workspaceDir)}`,
      },
    };
  });
};

export default routes;
