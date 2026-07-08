import type { FastifyPluginAsync } from "fastify";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadFlowState, logsDir } from "../../../dist/lib/workflow/state.js";
import { approveAllFlow, approveFlow } from "../../../dist/lib/workflow/engine.js";
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

const LOG_TAIL_BYTES = 10_000;
const MAX_OPERATION_OUTPUT = 20_000;
const MAX_RUN_OUTPUT = 40_000;

type RunRecord = {
  running: boolean;
  pid?: number;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  args: string[];
  stdout: string;
  stderr: string;
};

const runRegistry = new Map<string, RunRecord>();

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

async function recentLogs(workspaceDir: string): Promise<Array<{ name: string; content: string; truncated: boolean }>> {
  const dir = logsDir(workspaceDir);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names.sort().slice(-3).map(async (name) => {
      const raw = await fs.readFile(path.join(dir, name), "utf-8");
      return {
        name,
        content: raw.slice(-LOG_TAIL_BYTES),
        truncated: raw.length > LOG_TAIL_BYTES,
      };
    }),
  );
  return entries;
}

function longwriteBin(): string {
  return process.env.MALACLAW_LONGWRITE_BIN ?? process.env.LONGWRITE_BIN ?? "longwrite";
}

function runLongWrite(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(longwriteBin(), args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-MAX_OPERATION_OUTPUT);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_OPERATION_OUTPUT);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${longwriteBin()} ${args.join(" ")} failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}

function runStatus(workspaceDir: string): RunRecord | null {
  return runRegistry.get(workspaceDir) ?? null;
}

function appendTail(current: string, chunk: Buffer, maxBytes: number): string {
  return (current + chunk.toString()).slice(-maxBytes);
}

function spawnLongWriteRun(workspaceDir: string, opts: { runtime?: string; reset?: boolean }): RunRecord {
  const existing = runRegistry.get(workspaceDir);
  if (existing?.running) {
    throw Object.assign(new Error("LongWrite run is already active for this workspace"), { statusCode: 409 });
  }

  const args = ["run", workspaceDir];
  if (opts.runtime) args.push("--runtime", opts.runtime);
  if (opts.reset) args.push("--reset");

  const child: ChildProcessWithoutNullStreams = spawn(longwriteBin(), args, { cwd: workspaceDir, shell: false });
  const record: RunRecord = {
    running: true,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    args,
    stdout: "",
    stderr: "",
  };
  runRegistry.set(workspaceDir, record);

  child.stdout.on("data", (chunk: Buffer) => {
    record.stdout = appendTail(record.stdout, chunk, MAX_RUN_OUTPUT);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    record.stderr = appendTail(record.stderr, chunk, MAX_RUN_OUTPUT);
  });
  child.on("error", (err) => {
    record.running = false;
    record.finishedAt = new Date().toISOString();
    record.stderr = appendTail(record.stderr, Buffer.from(err.message), MAX_RUN_OUTPUT);
  });
  child.on("close", (code, signal) => {
    record.running = false;
    record.finishedAt = new Date().toISOString();
    record.exitCode = code;
    record.signal = signal;
  });

  return record;
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
    let logs: Array<{ name: string; content: string; truncated: boolean }> = [];
    try {
      flow = await loadFlowState(workspaceDir);
      usage = await summarizeUsage(workspaceDir);
      logs = await recentLogs(workspaceDir);
    } catch {
      flow = null;
      usage = null;
      logs = [];
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
      logs,
      operation: runStatus(workspaceDir),
      commands: {
        status: `longwrite status ${shellQuote(workspaceDir)}`,
        run: runCommand(workspaceDir, runtime),
        approve: approveCommand(workspaceDir, batchApprovals),
        packet: `longwrite report packet ${shellQuote(workspaceDir)}`,
      },
    };
  });

  app.post("/api/longwrite/approve", async (req, reply) => {
    const { dir, approvalId, batch } = (req.body ?? {}) as { dir?: string; approvalId?: string; batch?: boolean };
    const workspaceDir = requireDir(dir);
    try {
      const state = batch ? await approveAllFlow(workspaceDir) : await approveFlow(workspaceDir, approvalId ?? "");
      return { ok: true, state };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/longwrite/packet", async (req, reply) => {
    const { dir } = (req.body ?? {}) as { dir?: string };
    const workspaceDir = requireDir(dir);
    try {
      const result = await runLongWrite(["report", "packet", workspaceDir], workspaceDir);
      return { ok: true, ...result, artifact: "reports/human-review-packet.md" };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/longwrite/run", async (req, reply) => {
    const { dir, runtime, reset } = (req.body ?? {}) as { dir?: string; runtime?: string; reset?: boolean };
    const workspaceDir = requireDir(dir);
    if (runtime !== undefined && (typeof runtime !== "string" || runtime.trim().length === 0)) {
      return reply.status(400).send({ error: "runtime must be a non-empty string" });
    }
    try {
      const record = spawnLongWriteRun(workspaceDir, { runtime: runtime?.trim(), reset: reset === true });
      return { ok: true, operation: record };
    } catch (err) {
      const statusCode = typeof err === "object" && err !== null && "statusCode" in err
        ? Number((err as { statusCode?: number }).statusCode)
        : 500;
      return reply.status(Number.isFinite(statusCode) ? statusCode : 500)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
};

export default routes;
