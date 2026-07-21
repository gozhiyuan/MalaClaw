import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { loadFlowState, readEvents, logsDir, promptsDir } from "../../../dist/lib/workflow/state.js";
import { approveFlow, approveAllFlow, cancelFlow, pauseFlow, resumeFlow } from "../../../dist/lib/workflow/engine.js";
import { resolveWithin } from "../../../dist/lib/workflow/safe-paths.js";
import { summarizeUsage } from "../../../dist/commands/flow.js";
import { loadManifest } from "../../../dist/lib/loader.js";
import { readFlowLock, isProcessAlive } from "../../../dist/lib/workflow/lock.js";
import YAML from "yaml";

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

async function blockerReports(
  workspaceDir: string,
  events: Array<{ type?: unknown; ts?: unknown }>,
): Promise<Array<{ file: string; excerpt: string }>> {
  const reportsDir = path.join(workspaceDir, "reports");
  const blockers: Array<{ file: string; excerpt: string }> = [];
  // `flow reopen` starts a new execution generation while intentionally
  // preserving workspace artifacts. Old blocker reports are useful on disk,
  // but must not be presented as active blockers for the new generation.
  const lastReopen = [...events].reverse().find((event) => event.type === "flow_reopened");
  const reopenedAt = typeof lastReopen?.ts === "string" ? Date.parse(lastReopen.ts) : Number.NaN;
  for (const name of await listDir(reportsDir)) {
    if (!name.endsWith("-blocker.md")) continue;
    try {
      const stat = await fs.stat(path.join(reportsDir, name));
      if (Number.isFinite(reopenedAt) && stat.mtimeMs < reopenedAt) continue;
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

/**
 * A MrMaLiang program workspace is a parent directory; its executable
 * MalaClaw flow lives in the declared writing component.  The generic Flow
 * page should therefore accept either the component itself or its program
 * parent, just as the MrMaLiang dashboard tab does.  Other MalaClaw
 * workspaces remain unchanged.
 */
async function resolveFlowWorkspace(requestedDir: string): Promise<string> {
  try {
    await fs.access(path.join(requestedDir, "malaclaw.yaml"));
    return requestedDir;
  } catch {
    // Continue only when this is plausibly a MrMaLiang parent workspace.
  }

  try {
    const raw = await fs.readFile(path.join(requestedDir, "maliang.yaml"), "utf-8");
    const config = YAML.parse(raw) as { components?: { writing?: { workspace?: unknown } } };
    const component = config.components?.writing?.workspace;
    if (typeof component !== "string" || component.length === 0) return requestedDir;
    const candidate = path.resolve(requestedDir, component);
    const relative = path.relative(requestedDir, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return requestedDir;
    await fs.access(path.join(candidate, "malaclaw.yaml"));
    return candidate;
  } catch {
    return requestedDir;
  }
}

const routes: FastifyPluginAsync = async (app) => {
  app.get("/api/flow", async (req) => {
    const requestedDir = requireDir((req.query as { dir?: string }).dir);
    const dir = await resolveFlowWorkspace(requestedDir);
    const [state, events, usage, stages, logs, prompts] = await Promise.all([
      loadFlowState(dir),
      readEvents(dir),
      summarizeUsage(dir),
      stageViews(dir),
      listDir(logsDir(dir)),
      listDir(promptsDir(dir)),
    ]);
    const blockers = await blockerReports(dir, events as Array<{ type?: unknown; ts?: unknown }>);
    const lock = await readFlowLock(dir);
    const orphanReason = state?.status === "running" && (!lock || !isProcessAlive(lock.pid))
      ? lock ? `Scheduler pid ${lock.pid} is not alive.` : "No scheduler lock exists."
      : undefined;
    return {
      dir,
      requestedDir,
      state,
      orphaned: orphanReason !== undefined,
      orphanReason,
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
    const workspaceDir = await resolveFlowWorkspace(requireDir(dir));
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
    const workspaceDir = await resolveFlowWorkspace(requireDir(dir));
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
    const workspaceDir = await resolveFlowWorkspace(requireDir(dir));
    try {
      const state = await approveAllFlow(workspaceDir);
      return { ok: true, state };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/flow/pause", async (req, reply) => {
    const { dir } = (req.body ?? {}) as { dir?: string };
    const workspaceDir = await resolveFlowWorkspace(requireDir(dir));
    try {
      return { ok: true, state: await pauseFlow(workspaceDir) };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/flow/cancel", async (req, reply) => {
    const { dir, confirmed } = (req.body ?? {}) as { dir?: string; confirmed?: boolean };
    const workspaceDir = await resolveFlowWorkspace(requireDir(dir));
    if (confirmed !== true) return reply.status(400).send({ error: "confirmed: true is required for emergency cancellation" });
    try {
      return { ok: true, state: await cancelFlow(workspaceDir) };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/flow/resume", async (req, reply) => {
    const { dir } = (req.body ?? {}) as { dir?: string };
    const workspaceDir = await resolveFlowWorkspace(requireDir(dir));
    try {
      return { ok: true, state: await resumeFlow(workspaceDir) };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
};

export default routes;
