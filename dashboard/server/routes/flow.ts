import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { loadFlowState, readEvents, logsDir, promptsDir } from "../../../dist/lib/workflow/state.js";
import { approveFlow, approveAllFlow } from "../../../dist/lib/workflow/engine.js";
import { resolveWithin } from "../../../dist/lib/workflow/safe-paths.js";
import { summarizeUsage } from "../../../dist/commands/flow.js";
import { loadManifest } from "../../../dist/lib/loader.js";

const FILE_KINDS = { logs: logsDir, prompts: promptsDir } as const;
const SAFE_FLOW_FILE = /^[A-Za-z0-9][A-Za-z0-9._\[\]-]*$/;
const TAIL_BYTES = 20_000;

type StageView = {
  id: string;
  title?: string;
  type: "standard" | "foreach" | "loop";
  owner?: string;
  outputs: Array<{ path: string; exists: boolean }>;
};

type LoopView = {
  id: string;
  title?: string;
  maxRounds: number;
  stopWhen?: string;
  rounds: number;
  status?: string;
  /** Current value of the stop_when metric from reports/metrics.json. */
  current?: number;
};

function stageOutputs(stage: Record<string, unknown>): string[] {
  if (Array.isArray(stage.stages)) {
    return (stage.stages as Array<Record<string, unknown>>).flatMap(stageOutputs);
  }
  if (Array.isArray(stage.steps)) {
    return (stage.steps as Array<{ outputs?: string[] }>).flatMap((s) => s.outputs ?? []);
  }
  return (stage.outputs as string[] | undefined) ?? [];
}

async function readStopMetric(workspaceDir: string, stopWhen?: string): Promise<number | undefined> {
  const metric = stopWhen?.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
  if (!metric) return undefined;
  try {
    const raw = await fs.readFile(path.join(workspaceDir, "reports", "metrics.json"), "utf-8");
    const value = (JSON.parse(raw) as Record<string, unknown>)[metric];
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}

async function stageViews(workspaceDir: string): Promise<StageView[]> {
  let manifest;
  try {
    manifest = await loadManifest(workspaceDir);
  } catch {
    return [];
  }
  const workflow = manifest.workflow;
  if (!workflow) return [];
  const views: StageView[] = [];
  for (const stage of workflow.stages) {
    const outputs = stageOutputs(stage as Record<string, unknown>);
    const checked = await Promise.all(
      outputs.map(async (out) => {
        // Globs and {{item}} templates can't be existence-checked directly.
        if (out.includes("*") || out.includes("{{")) return { path: out, exists: false };
        try {
          await fs.access(resolveWithin(workspaceDir, out));
          return { path: out, exists: true };
        } catch {
          return { path: out, exists: false };
        }
      }),
    );
    views.push({
      id: stage.id,
      title: (stage as { title?: string }).title,
      type: "stages" in stage ? "loop" : "steps" in stage && stage.steps ? "foreach" : "standard",
      owner: (stage as { owner?: string }).owner,
      outputs: checked,
    });
  }
  return views;
}

async function loopViews(
  workspaceDir: string,
  units: Record<string, { rounds?: number; status?: string }>,
): Promise<LoopView[]> {
  let manifest;
  try {
    manifest = await loadManifest(workspaceDir);
  } catch {
    return [];
  }
  const views: LoopView[] = [];
  for (const stage of manifest.workflow?.stages ?? []) {
    if (!("stages" in stage)) continue;
    views.push({
      id: stage.id,
      title: stage.title,
      maxRounds: stage.max_rounds,
      stopWhen: stage.stop_when,
      rounds: units[stage.id]?.rounds ?? 0,
      status: units[stage.id]?.status,
      current: await readStopMetric(workspaceDir, stage.stop_when),
    });
  }
  return views;
}

type UsageEvent = {
  type: string;
  key?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; cost_usd?: number };
};

function usageByUnit(events: UsageEvent[]): Record<string, { totalTokens: number; costUsd: number }> {
  const byUnit: Record<string, { totalTokens: number; costUsd: number }> = {};
  for (const event of events) {
    if (event.type !== "unit_succeeded" || !event.usage || !event.key) continue;
    const entry = (byUnit[event.key] ??= { totalTokens: 0, costUsd: 0 });
    entry.totalTokens +=
      event.usage.total_tokens ?? (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
    entry.costUsd += event.usage.cost_usd ?? 0;
  }
  return byUnit;
}

async function blockerReports(workspaceDir: string): Promise<Array<{ file: string; excerpt: string }>> {
  const reportsDir = path.join(workspaceDir, "reports");
  const blockers: Array<{ file: string; excerpt: string }> = [];
  for (const name of await listDir(reportsDir)) {
    if (!name.endsWith("-blocker.md")) continue;
    try {
      const content = await fs.readFile(path.join(reportsDir, name), "utf-8");
      blockers.push({ file: `reports/${name}`, excerpt: content.slice(0, 400) });
    } catch {
      /* unreadable blocker is not itself a blocker */
    }
  }
  return blockers;
}

function requireDir(dir: unknown): string {
  if (typeof dir !== "string" || dir.length === 0 || !path.isAbsolute(dir)) {
    throw Object.assign(new Error("dir must be an absolute workspace path"), { statusCode: 400 });
  }
  return dir;
}

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/flow", async (req) => {
    const dir = requireDir((req.query as { dir?: string }).dir);
    const [state, events, usage, stages, blockers, logs, prompts] = await Promise.all([
      loadFlowState(dir),
      readEvents(dir),
      summarizeUsage(dir),
      stageViews(dir),
      blockerReports(dir),
      listDir(logsDir(dir)),
      listDir(promptsDir(dir)),
    ]);
    return {
      dir,
      state,
      stages,
      loops: await loopViews(dir, state?.units ?? {}),
      usage,
      usageByUnit: usageByUnit(events as UsageEvent[]),
      blockers,
      files: { logs, prompts },
      events: events.slice(-50),
    };
  });

  app.get("/api/flow/file", async (req, reply) => {
    const { dir, kind, name } = req.query as { dir?: string; kind?: string; name?: string };
    const workspaceDir = requireDir(dir);
    const kindDir = FILE_KINDS[kind as keyof typeof FILE_KINDS];
    if (!kindDir || !name || !SAFE_FLOW_FILE.test(name)) {
      return reply.status(400).send({ error: "kind must be logs|prompts and name must be a flow file" });
    }
    try {
      const filePath = resolveWithin(kindDir(workspaceDir), name);
      const content = await fs.readFile(filePath, "utf-8");
      return { name, content: content.slice(-TAIL_BYTES), truncated: content.length > TAIL_BYTES };
    } catch {
      return reply.status(404).send({ error: `no such ${kind} file: ${name}` });
    }
  });

  app.post("/api/flow/approve", async (req, reply) => {
    const { dir, approvalId } = (req.body ?? {}) as { dir?: string; approvalId?: string };
    const workspaceDir = requireDir(dir);
    if (!approvalId) return reply.status(400).send({ error: "approvalId is required" });
    try {
      const state = await approveFlow(workspaceDir, approvalId);
      return { ok: true, state };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/flow/approve-all", async (req, reply) => {
    const { dir } = (req.body ?? {}) as { dir?: string };
    const workspaceDir = requireDir(dir);
    try {
      const state = await approveAllFlow(workspaceDir);
      return { ok: true, state };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
};

export default routes;
