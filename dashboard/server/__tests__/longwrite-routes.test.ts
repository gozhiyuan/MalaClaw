import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { createServer } from "../index.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let ws: string;
let originalLongWriteBin: string | undefined;

beforeAll(async () => {
  originalLongWriteBin = process.env.MALACLAW_LONGWRITE_BIN;
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-longwrite-route-"));
  await fs.mkdir(path.join(ws, ".malaclaw", "flow", "logs"), { recursive: true });
  const stub = path.join(ws, "longwrite-stub.js");
  await fs.writeFile(
    stub,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cmd = process.argv[2];",
      "if (cmd === 'validate') {",
      "  const workspace = process.argv[4];",
      "  const raw = fs.readFileSync(path.join(workspace, 'longwrite.yaml'), 'utf8');",
      "  if (raw.includes('batchApprovals')) { console.error('review: Unrecognized key'); process.exit(1); }",
      "  if (!raw.includes('version: 1')) { console.error('version: Invalid literal value, expected 1'); process.exit(1); }",
      "  console.log('config valid');",
      "  process.exit(0);",
      "}",
      "const workspace = cmd === 'report' ? process.argv[4] : process.argv[3];",
      "if (cmd === 'report') {",
      "  fs.mkdirSync(path.join(workspace, 'reports'), { recursive: true });",
      "  fs.writeFileSync(path.join(workspace, 'reports', 'human-review-packet.md'), '# Packet\\n');",
      "  console.log('wrote packet');",
      "  process.exit(0);",
      "}",
      "if (cmd === 'run') {",
      "  console.log('run started ' + process.argv.slice(2).join(' '));",
      "  setTimeout(() => {",
      "    fs.mkdirSync(path.join(workspace, 'reports'), { recursive: true });",
      "    fs.writeFileSync(path.join(workspace, 'reports', 'stub-run.txt'), 'done\\n');",
      "    console.log('run finished');",
      "  }, 250);",
      "  setTimeout(() => process.exit(0), 300);",
      "}",
    ].join("\n"),
    "utf-8",
  );
  await fs.chmod(stub, 0o755);
  process.env.MALACLAW_LONGWRITE_BIN = stub;
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
  await fs.writeFile(path.join(ws, ".malaclaw", "flow", "logs", "outline-attempt1.log"), "outline worker log", "utf-8");
  app = await createServer({ port: 0 });
});

afterAll(async () => {
  if (originalLongWriteBin === undefined) delete process.env.MALACLAW_LONGWRITE_BIN;
  else process.env.MALACLAW_LONGWRITE_BIN = originalLongWriteBin;
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
    expect(body.logs[0].name).toBe("outline-attempt1.log");
    expect(body.logs[0].content).toContain("outline worker log");
    expect(body.commands.run).toContain("--runtime 'codex'");
    expect(body.commands.packet).toContain("longwrite report packet");
  });

  it("POST /api/longwrite/approve grants pending approvals", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/longwrite/approve",
      payload: { dir: ws, approvalId: "approve-outline-001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.pendingApprovals).toHaveLength(0);
  });

  it("POST /api/longwrite/packet delegates to the LongWrite CLI", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/longwrite/packet",
      payload: { dir: ws },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stdout).toContain("wrote packet");
    expect(await fs.readFile(path.join(ws, "reports", "human-review-packet.md"), "utf-8")).toContain("Packet");
  });

  it("POST /api/longwrite/run starts one run per workspace and records output", async () => {
    const started = await app.inject({
      method: "POST",
      url: "/api/longwrite/run",
      payload: { dir: ws, runtime: "dry-run" },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().operation.running).toBe(true);
    expect(started.json().operation.args).toEqual(["run", ws, "--runtime", "dry-run"]);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/longwrite/run",
      payload: { dir: ws, runtime: "dry-run" },
    });
    expect(duplicate.statusCode).toBe(409);

    await new Promise((resolve) => setTimeout(resolve, 450));
    const status = await app.inject({ method: "GET", url: `/api/longwrite?dir=${encodeURIComponent(ws)}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().operation.running).toBe(false);
    expect(status.json().operation.exitCode).toBe(0);
    expect(status.json().operation.stdout).toContain("run finished");
    expect(await fs.readFile(path.join(ws, "reports", "stub-run.txt"), "utf-8")).toContain("done");
  });

  it("POST /api/longwrite/config validates before writing longwrite.yaml", async () => {
    const config = {
      version: 1,
      project: { id: "survey", name: "Updated Survey", artifact_type: "research_paper", mode: "auto_research_v2_lite" },
      research: { provider: "seed", topic: "Updated topic" },
      review: { cadence: "interval", time: "08:00", interval_hours: 6, batch_approvals: false },
    };

    const saved = await app.inject({
      method: "POST",
      url: "/api/longwrite/config",
      payload: { dir: ws, config },
    });
    expect(saved.statusCode).toBe(200);
    const raw = await fs.readFile(path.join(ws, "longwrite.yaml"), "utf-8");
    expect(raw).toContain("Updated Survey");
    expect(raw).toContain("interval_hours: 6");

    const invalid = await app.inject({
      method: "POST",
      url: "/api/longwrite/config",
      payload: { dir: ws, config: { ...config, review: { ...config.review, batchApprovals: true } } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toContain("Unrecognized key");
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
