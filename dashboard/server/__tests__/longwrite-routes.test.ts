import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { createServer } from "../index.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let ws: string;

beforeAll(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-longwrite-route-"));
  await fs.mkdir(path.join(ws, ".malaclaw", "flow"), { recursive: true });
  await fs.writeFile(path.join(ws, "longwrite.yaml"), stringifyYaml({
    version: 1,
    project: {
      id: "survey",
      name: "Survey",
      artifact_type: "research_paper",
      mode: "auto_research_v2_lite",
    },
    research: { provider: "arxiv", topic: "Long-horizon agent memory" },
    review: { cadence: "daily", time: "08:00", interval_hours: 4, batch_approvals: true },
  }), "utf-8");
  await fs.writeFile(path.join(ws, "malaclaw.yaml"), stringifyYaml({
    version: 1,
    runtime: "codex",
    workflow: {
      mode: "auto_research_v2_lite",
      artifact_type: "research_paper",
      budget_usd: 5,
      model_tiers: {
        cheap: { runtime: "openai-api", model: "gpt-5-mini", max_cost_usd: 0.25 },
      },
      stages: [
        { id: "outline", owner: "outline-architect", outputs: ["outline.md"], requires_human_approval: true },
        {
          id: "draft_sections",
          type: "foreach",
          foreach: "outline.sections",
          item_name: "section",
          max_parallel: 4,
          steps: [
            { id: "draft", owner: "chapter-writer", runtime: "script", outputs: ["chapters/{{section.id}}.md"] },
          ],
        },
      ],
    },
  }), "utf-8");
  await fs.writeFile(path.join(ws, ".malaclaw", "flow", "state.json"), JSON.stringify({
    version: 1,
    workflowHash: "abc",
    status: "paused_for_approval",
    updatedAt: "2026-07-08T12:00:00.000Z",
    units: { outline: { status: "succeeded" } },
    pendingApprovals: [{ id: "approve-outline-001", stageId: "outline", artifacts: ["outline.md"] }],
    foreachItems: {},
  }), "utf-8");
  app = await createServer({ port: 0 });
});

afterAll(async () => {
  await app.close();
  await fs.rm(ws, { recursive: true, force: true });
});

describe("longwrite routes", () => {
  it("GET /api/longwrite returns project, workflow, flow, usage, and command hints", async () => {
    const res = await app.inject({ method: "GET", url: `/api/longwrite?dir=${encodeURIComponent(ws)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.project.name).toBe("Survey");
    expect(body.project.mode).toBe("auto_research_v2_lite");
    expect(body.research.topic).toBe("Long-horizon agent memory");
    expect(body.review.batchApprovals).toBe(true);
    expect(body.workflow.runtime).toBe("codex");
    expect(body.workflow.budgetUsd).toBe(5);
    expect(body.workflow.stages[1].type).toBe("foreach");
    expect(body.workflow.stages[1].steps[0].runtime).toBe("script");
    expect(body.flow.status).toBe("paused_for_approval");
    expect(body.commands.run).toContain("--runtime 'codex'");
    expect(body.commands.packet).toContain("longwrite report packet");
  });

  it("shell-quotes command hints without allowing shell expansion", async () => {
    const dir = path.join(os.tmpdir(), `malaclaw $USER's survey ${Date.now()}`);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "longwrite.yaml"), stringifyYaml({
        version: 1,
        project: { id: "quoted", artifact_type: "research_paper", mode: "auto_research_v2_lite" },
        review: { cadence: "manual", batch_approvals: false },
      }), "utf-8");
      await fs.writeFile(path.join(dir, "malaclaw.yaml"), stringifyYaml({
        version: 1,
        runtime: "codex",
        workflow: { stages: [] },
      }), "utf-8");

      const res = await app.inject({ method: "GET", url: `/api/longwrite?dir=${encodeURIComponent(dir)}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.commands.status).toBe(`longwrite status '${dir.replace(/'/g, "'\\''")}'`);
      expect(body.commands.run).toContain(`longwrite run '${dir.replace(/'/g, "'\\''")}' --runtime 'codex'`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("GET /api/longwrite rejects non-LongWrite workspaces", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-not-longwrite-"));
    try {
      const res = await app.inject({ method: "GET", url: `/api/longwrite?dir=${encodeURIComponent(dir)}` });
      expect(res.statusCode).toBe(404);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
