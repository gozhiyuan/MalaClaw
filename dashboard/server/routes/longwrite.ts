import type { FastifyPluginAsync } from "fastify";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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

type ProjectConfig = YamlRecord & {
  version?: unknown;
  project?: YamlRecord;
  research?: YamlRecord;
  writing?: YamlRecord;
  review?: YamlRecord;
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

function initArgs(body: {
  dir?: string;
  mode?: string;
  topic?: string;
  name?: string;
  targetLengthWords?: number;
  genre?: string;
  audience?: string;
  style?: string;
  researchProvider?: string;
  reviewCadence?: string;
  reviewTime?: string;
  reviewIntervalHours?: number;
  batchApprovals?: boolean;
  referenceLinks?: string[];
  referenceFiles?: string[];
}): { targetDir: string; args: string[] } {
  const targetDir = requireDir(body.dir);
  const args = ["init", targetDir];
  const pairs: Array<[string, string | number | boolean | undefined]> = [
    ["--mode", body.mode],
    ["--topic", body.topic],
    ["--name", body.name],
    ["--target-length-words", body.targetLengthWords],
    ["--genre", body.genre],
    ["--audience", body.audience],
    ["--style", body.style],
    ["--research-provider", body.researchProvider],
    ["--review-cadence", body.reviewCadence],
    ["--review-time", body.reviewTime],
    ["--review-interval-hours", body.reviewIntervalHours],
  ];
  for (const [flag, value] of pairs) {
    if (value !== undefined && value !== "") args.push(flag, String(value));
  }
  if (body.batchApprovals) args.push("--batch-approvals");
  for (const link of body.referenceLinks ?? []) if (link.trim()) args.push("--reference-link", link.trim());
  for (const file of body.referenceFiles ?? []) if (file.trim()) args.push("--reference-file", file.trim());
  return { targetDir, args };
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

async function validateProjectConfig(config: unknown): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-longwrite-config-"));
  try {
    await fs.writeFile(path.join(tempDir, "longwrite.yaml"), stringifyYaml(config), "utf-8");
    await runLongWrite(["validate", "config", tempDir], tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
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
    const writing = asRecord(longwrite.writing);
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
      config: longwrite,
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
      writing: {
        targetLengthWords: asNumber(writing.target_length_words),
        genre: asString(writing.genre),
        audience: asString(writing.audience),
        styleInstructions: asString(writing.style_instructions),
        referenceLinks: asStringArray(writing.reference_links),
        referenceFiles: asStringArray(writing.reference_files),
        outputFormats: asStringArray(writing.output_formats),
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
        feedback: `longwrite feedback add ${shellQuote(workspaceDir)} --message ${shellQuote("...")}`,
      },
    };
  });

  app.post("/api/longwrite/init", async (req, reply) => {
    const body = (req.body ?? {}) as Parameters<typeof initArgs>[0];
    try {
      const { targetDir, args } = initArgs(body);
      const result = await runLongWrite(args, path.dirname(targetDir));
      return { ok: true, dir: targetDir, ...result };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
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

  app.post("/api/longwrite/feedback", async (req, reply) => {
    const { dir, message } = (req.body ?? {}) as { dir?: string; message?: string };
    const workspaceDir = requireDir(dir);
    if (typeof message !== "string" || message.trim().length === 0) {
      return reply.status(400).send({ error: "message must be a non-empty string" });
    }
    try {
      const result = await runLongWrite(["feedback", "add", workspaceDir, "--message", message], workspaceDir);
      return { ok: true, artifact: "feedback/user-feedback.md", ...result };
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

  app.post("/api/longwrite/config", async (req, reply) => {
    const { dir, config } = (req.body ?? {}) as { dir?: string; config?: ProjectConfig };
    const workspaceDir = requireDir(dir);
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      return reply.status(400).send({ error: "config must be an object" });
    }
    try {
      await validateProjectConfig(config);
      const target = path.join(workspaceDir, "longwrite.yaml");
      await fs.writeFile(target, stringifyYaml(config), "utf-8");
      return { ok: true, path: "longwrite.yaml" };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
};

export default routes;
