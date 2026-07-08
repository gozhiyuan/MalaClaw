import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../index.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let ws: string;

const state = {
  version: 1,
  workflowHash: "abcd1234abcd1234",
  status: "paused_for_approval",
  units: {
    outline: {
      status: "succeeded", attempts: 1, rounds: 1,
      lastOutcome: "success", requestedRuntime: "dry-run", actualRuntime: "dry-run",
      approvalGranted: false,
    },
    draft: { status: "pending", attempts: 0, rounds: 0, approvalGranted: false },
    quality_loop: { status: "running", attempts: 0, rounds: 1, approvalGranted: false },
    "quality_loop-r1-review": { status: "succeeded", attempts: 1, rounds: 0, approvalGranted: false },
  },
  pendingApprovals: [
    { id: "approve-outline-001", stageId: "outline", artifacts: ["outline.md"] },
  ],
  foreachItems: {},
  updatedAt: new Date().toISOString(),
};

beforeAll(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-flow-route-"));
  const flowDir = path.join(ws, ".malaclaw", "flow");
  await fs.mkdir(path.join(flowDir, "logs"), { recursive: true });
  await fs.mkdir(path.join(flowDir, "prompts"), { recursive: true });
  await fs.mkdir(path.join(ws, "reports"), { recursive: true });
  await fs.writeFile(path.join(flowDir, "state.json"), JSON.stringify(state), "utf-8");
  await fs.writeFile(
    path.join(flowDir, "events.jsonl"),
    [
      JSON.stringify({ ts: "2026-07-08T00:00:00Z", type: "unit_started", key: "outline" }),
      JSON.stringify({ ts: "2026-07-08T00:01:00Z", type: "unit_succeeded", key: "outline", usage: { total_tokens: 1200 } }),
      JSON.stringify({ ts: "2026-07-08T00:02:00Z", type: "unit_succeeded", key: "quality_loop-r1-review", usage: { total_tokens: 500 } }),
    ].join("\n") + "\n",
    "utf-8",
  );
  await fs.writeFile(path.join(flowDir, "logs", "outline-attempt1.log"), "worker output here", "utf-8");
  await fs.writeFile(path.join(flowDir, "prompts", "outline-attempt1.md"), "# contract", "utf-8");
  await fs.writeFile(path.join(ws, "reports", "outline-blocker.md"), "# Blocker: outline", "utf-8");
  await fs.writeFile(path.join(ws, "outline.md"), "# Outline", "utf-8");
  await fs.writeFile(path.join(ws, "reports", "metrics.json"), JSON.stringify({ review_score: 6.8 }), "utf-8");
  await fs.writeFile(
    path.join(ws, "malaclaw.yaml"),
    [
      "version: 1",
      "project:",
      "  id: flow-fixture",
      "  name: flow-fixture",
      "workflow:",
      "  stages:",
      "    - id: outline",
      "      owner: pm",
      "      outputs: [outline.md]",
      "    - id: quality_loop",
      "      type: loop",
      "      max_rounds: 5",
      "      stop_when: review_score >= 8.0",
      "      stages:",
      "        - id: review",
      "          owner: reviewer",
      "          outputs: [reviews/review.md]",
      "",
    ].join("\n"),
    "utf-8",
  );
  app = await createServer({ port: 0 });
});

afterAll(async () => {
  await app.close();
  await fs.rm(ws, { recursive: true, force: true });
});

describe("flow routes", () => {
  it("GET /api/flow returns state, usage, files, blockers, events", async () => {
    const res = await app.inject({ method: "GET", url: `/api/flow?dir=${encodeURIComponent(ws)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state.status).toBe("paused_for_approval");
    expect(body.state.units.outline.status).toBe("succeeded");
    expect(body.usage.totalTokens).toBe(1700);
    expect(body.usage.unitsWithUsage).toBe(2);
    expect(body.files.logs).toContain("outline-attempt1.log");
    expect(body.files.prompts).toContain("outline-attempt1.md");
    expect(body.blockers[0].file).toBe("reports/outline-blocker.md");
    expect(body.events.at(-1).type).toBe("unit_succeeded");
  });

  it("GET /api/flow reports loop views and per-unit usage", async () => {
    const res = await app.inject({ method: "GET", url: `/api/flow?dir=${encodeURIComponent(ws)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.loops).toHaveLength(1);
    expect(body.loops[0]).toMatchObject({
      id: "quality_loop",
      maxRounds: 5,
      stopWhen: "review_score >= 8.0",
      rounds: 1,
      status: "running",
      current: 6.8,
    });
    expect(body.usageByUnit["quality_loop-r1-review"].totalTokens).toBe(500);
    expect(body.stages.find((s: { id: string }) => s.id === "quality_loop").type).toBe("loop");
  });

  it("GET /api/flow rejects relative dirs", async () => {
    const res = await app.inject({ method: "GET", url: "/api/flow?dir=../etc" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/flow/file serves log tails and refuses traversal", async () => {
    const ok = await app.inject({
      method: "GET",
      url: `/api/flow/file?dir=${encodeURIComponent(ws)}&kind=logs&name=outline-attempt1.log`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().content).toContain("worker output");

    const evil = await app.inject({
      method: "GET",
      url: `/api/flow/file?dir=${encodeURIComponent(ws)}&kind=logs&name=${encodeURIComponent("../../../malaclaw.yaml")}`,
    });
    expect(evil.statusCode).toBe(400);
  });

  it("POST /api/flow/approve grants the approval and updates state", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/flow/approve",
      payload: { dir: ws, approvalId: "approve-outline-001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state.pendingApprovals).toHaveLength(0);
  });

  it("POST /api/flow/approve rejects unknown approval ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/flow/approve",
      payload: { dir: ws, approvalId: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });
});
