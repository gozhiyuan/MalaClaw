import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import {
  parseStopCondition,
  evaluateStopCondition,
} from "../src/lib/workflow/stop-condition.js";
import { validateWorkflowSemantics } from "../src/lib/workflow/validate.js";
import { runFlow } from "../src/lib/workflow/engine.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { readEvents } from "../src/lib/workflow/state.js";
import type { StageRunRequest } from "../src/lib/workflow/runtimes/base.js";

const tempDirs: string[] = [];
async function makeWorkspace(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-rounds-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf-8");
  }
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe("parseStopCondition", () => {
  it("parses all supported operators", () => {
    for (const op of [">=", ">", "<=", "<", "=="]) {
      const parsed = parseStopCondition(`review_score ${op} 8.5`);
      expect(parsed).toEqual({ metric: "review_score", op, threshold: 8.5 });
    }
  });

  it("rejects malformed expressions", () => {
    expect(parseStopCondition("review_score is nice")).toBeNull();
    expect(parseStopCondition("")).toBeNull();
    expect(parseStopCondition(">= 8")).toBeNull();
    expect(parseStopCondition("score >= high")).toBeNull();
  });
});

describe("evaluateStopCondition", () => {
  it("evaluates against reports/metrics.json", async () => {
    const ws = await makeWorkspace({ "reports/metrics.json": '{"review_score": 8.5}' });
    expect(await evaluateStopCondition(ws, "review_score >= 8.0")).toEqual({ met: true, current: 8.5 });
    expect(await evaluateStopCondition(ws, "review_score >= 9")).toEqual({ met: false, current: 8.5 });
  });

  it("is unmet when the file, metric, or value is unusable", async () => {
    const empty = await makeWorkspace();
    expect((await evaluateStopCondition(empty, "review_score >= 8")).met).toBe(false);

    const wrongMetric = await makeWorkspace({ "reports/metrics.json": '{"other": 9}' });
    expect((await evaluateStopCondition(wrongMetric, "review_score >= 8")).met).toBe(false);

    const nonNumeric = await makeWorkspace({ "reports/metrics.json": '{"review_score": "great"}' });
    expect((await evaluateStopCondition(nonNumeric, "review_score >= 8")).met).toBe(false);
  });
});

describe("stop_when semantic validation", () => {
  const owners = new Set(["pm"]);

  it("rejects stop_when without max_rounds", () => {
    const wf = WorkflowDef.parse({
      stages: [{ id: "revise", owner: "pm", stop_when: "review_score >= 8" }],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.errors.join("\n")).toContain("max_rounds");
  });

  it("rejects unparseable stop_when", () => {
    const wf = WorkflowDef.parse({
      stages: [{ id: "revise", owner: "pm", max_rounds: 3, stop_when: "vibes are good" }],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.errors.join("\n")).toContain("stop_when");
  });

  it("accepts a valid loop config", () => {
    const wf = WorkflowDef.parse({
      stages: [{ id: "revise", owner: "pm", max_rounds: 3, stop_when: "review_score >= 8" }],
    });
    expect(validateWorkflowSemantics(wf, owners).errors).toEqual([]);
  });

  it("validates loop-group child owners and stop conditions", () => {
    const wf = WorkflowDef.parse({
      stages: [{
        type: "loop",
        id: "quality",
        max_rounds: 2,
        stop_when: "review_score >= 8",
        stages: [
          { id: "review", owner: "pm", outputs: ["reviews/scorecard.json"] },
          { id: "revise", owner: "missing-agent", inputs: ["reviews/scorecard.json"], outputs: ["chapters/*.md"] },
        ],
      }],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.errors.join("\n")).toContain("quality.revise");
    expect(result.errors.join("\n")).toContain("missing-agent");
  });
});

/** Test runtime: succeeds like dry-run but bumps review_score by `step` per call. */
function scoringRuntime(startScore: number, step: number) {
  const inner = new DryRunRuntime();
  let score = startScore;
  return {
    id: "dry-run",
    checkAvailable: () => inner.checkAvailable(),
    async runStage(req: StageRunRequest) {
      const result = await inner.runStage(req);
      const metricsPath = path.join(req.workspaceDir, "reports", "metrics.json");
      await fs.mkdir(path.dirname(metricsPath), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify({ review_score: score }), "utf-8");
      score += step;
      return result;
    },
  };
}

describe("engine rounds loop", () => {
  it("runs a fixed number of rounds when there is no stop condition", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{ id: "revise", owner: "pm", outputs: ["draft.md"], max_rounds: 3 }],
    });
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("completed");
    expect(state.units.revise.rounds).toBe(3);
    const events = await readEvents(ws);
    expect(events.filter((e) => e.type === "unit_started" && e.key === "revise")).toHaveLength(3);
  });

  it("stops early when the stop condition is met", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{
        id: "revise", owner: "pm", outputs: ["draft.md"],
        max_rounds: 5, stop_when: "review_score >= 8.0",
      }],
    });
    // round 1 → 7.0, round 2 → 8.5
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: scoringRuntime(7.0, 1.5) });
    expect(state.status).toBe("completed");
    expect(state.units.revise.rounds).toBe(2);
    const events = await readEvents(ws);
    expect(events.some((e) => e.type === "stop_condition_met" && e.key === "revise")).toBe(true);
  });

  it("proceeds with revision_rounds_exhausted when the cap is hit unmet", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [
        {
          id: "revise", owner: "pm", outputs: ["draft.md"],
          max_rounds: 2, stop_when: "review_score >= 9.5",
        },
        { id: "build", owner: "pm", outputs: ["final.md"] },
      ],
    });
    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: scoringRuntime(6, 0.5) });
    expect(state.status).toBe("completed"); // bounded improvement, not failure
    expect(state.units.revise.status).toBe("succeeded");
    expect(state.units.revise.rounds).toBe(2);
    expect(state.units.build.status).toBe("succeeded");
    const events = await readEvents(ws);
    expect(events.some((e) => e.type === "revision_rounds_exhausted" && e.key === "revise")).toBe(true);
  });

  it("seeds round feedback into later-round prompts", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{
        id: "revise", owner: "pm", outputs: ["draft.md"],
        max_rounds: 2, stop_when: "review_score >= 9.5",
      }],
    });
    await runFlow({ workflow: wf, workspaceDir: ws, runtime: scoringRuntime(6, 0.5) });
    const promptFiles = await fs.readdir(path.join(ws, ".malaclaw/flow/prompts"));
    const round2 = promptFiles.filter((f) => f.startsWith("revise-")).sort().at(-1)!;
    const prompt = await fs.readFile(path.join(ws, ".malaclaw/flow/prompts", round2), "utf-8");
    expect(prompt).toContain("Revision round 2 of 2");
    expect(prompt).toContain("review_score >= 9.5");
  });

  it("keeps per-round prompt files instead of overwriting round 1", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{
        id: "revise", owner: "pm", outputs: ["draft.md"],
        max_rounds: 3, stop_when: "review_score >= 9.5",
      }],
    });
    await runFlow({ workflow: wf, workspaceDir: ws, runtime: scoringRuntime(6, 0.5) });
    const promptFiles = (await fs.readdir(path.join(ws, ".malaclaw/flow/prompts"))).sort();
    // Rounds reset the attempt counter; the round tag keeps the files distinct.
    expect(promptFiles).toEqual([
      "revise-attempt1.md",
      "revise-round2-attempt1.md",
      "revise-round3-attempt1.md",
    ]);
  });

  it("resumes an interrupted loop with the remaining round budget", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{
        id: "revise", owner: "pm", outputs: ["draft.md"],
        max_rounds: 3, stop_when: "review_score >= 99",
      }],
    });
    // Round 1 succeeds, round 2's worker hits a quota blocker → flow pauses.
    const inner = scoringRuntime(1, 1);
    let calls = 0;
    const first = {
      id: "dry-run",
      checkAvailable: () => inner.checkAvailable(),
      async runStage(req: StageRunRequest) {
        calls += 1;
        if (calls === 2) {
          return { outcome: "quota_exhausted" as const, producedFiles: [], message: "quota" };
        }
        return inner.runStage(req);
      },
    };
    const paused = await runFlow({ workflow: wf, workspaceDir: ws, runtime: first });
    expect(paused.status).toBe("paused_blocker");
    expect(paused.units.revise.rounds).toBe(1);

    const resumed = await runFlow({ workflow: wf, workspaceDir: ws, runtime: scoringRuntime(2, 1) });
    expect(resumed.status).toBe("completed");
    expect(resumed.units.revise.rounds).toBe(3); // 1 before pause + 2 after
  });
});

function loopScoringRuntime(scores: Record<number, number>) {
  const inner = new DryRunRuntime();
  return {
    id: "dry-run",
    checkAvailable: () => inner.checkAvailable(),
    async runStage(req: StageRunRequest) {
      const result = await inner.runStage(req);
      const match = req.unitKey.match(/^quality-r(\d+)-build$/);
      if (match) {
        const round = Number(match[1]);
        const metricsPath = path.join(req.workspaceDir, "reports", "metrics.json");
        await fs.mkdir(path.dirname(metricsPath), { recursive: true });
        await fs.writeFile(metricsPath, JSON.stringify({ review_score: scores[round] ?? 0 }), "utf-8");
      }
      return result;
    },
  };
}

describe("engine loop groups", () => {
  it("runs a multi-stage loop until the group stop condition is met", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{
        type: "loop",
        id: "quality",
        max_rounds: 4,
        stop_when: "review_score >= 8.0",
        stages: [
          { id: "review", owner: "pm", outputs: ["reviews/scorecard.json"] },
          { id: "route", owner: "pm", inputs: ["reviews/scorecard.json"], outputs: ["reports/routing.md"] },
          { id: "revise", owner: "pm", inputs: ["reports/routing.md"], outputs: ["chapters/*.md"] },
          { id: "build", owner: "pm", inputs: ["chapters/*.md"], outputs: ["build/manuscript.pdf"] },
        ],
      }],
    });

    const state = await runFlow({ workflow: wf, workspaceDir: ws, runtime: loopScoringRuntime({ 1: 6.5, 2: 8.25 }) });
    expect(state.status).toBe("completed");
    expect(state.units.quality.rounds).toBe(2);
    expect(state.units["quality-r1-review"].status).toBe("succeeded");
    expect(state.units["quality-r2-build"].status).toBe("succeeded");
    expect(state.units["quality-r3-review"]).toBeUndefined();
    const events = await readEvents(ws);
    expect(events.filter((e) => e.type === "loop_round_completed" && e.key === "quality")).toHaveLength(2);
    expect(events.some((e) => e.type === "stop_condition_met" && e.key === "quality")).toBe(true);
  });

  it("resumes a loop group after a child approval gate", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{
        type: "loop",
        id: "quality",
        max_rounds: 1,
        stages: [
          { id: "review", owner: "pm", outputs: ["reviews/scorecard.json"], requires_human_approval: true },
          { id: "revise", owner: "pm", inputs: ["reviews/scorecard.json"], outputs: ["chapters/*.md"] },
        ],
      }],
    });
    const paused = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(paused.status).toBe("paused_for_approval");
    expect(paused.pendingApprovals[0].stageId).toBe("quality-r1-review");
    expect(paused.units["quality-r1-revise"].status).toBe("pending");

    const { approveAllFlow } = await import("../src/lib/workflow/engine.js");
    await approveAllFlow(ws);
    const resumed = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(resumed.status).toBe("completed");
    expect(resumed.units.quality.rounds).toBe(1);
    expect(resumed.units["quality-r1-revise"].status).toBe("succeeded");
  });

  it("pauses for budget approval on a loop child model tier", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      model_tiers: {
        strong: { runtime: "dry-run", model: "expensive-model", requires_budget_approval: true },
      },
      stages: [{
        type: "loop",
        id: "quality",
        max_rounds: 1,
        stages: [
          { id: "review", owner: "pm", model_tier: "strong", outputs: ["reviews/scorecard.json"] },
        ],
      }],
    });
    const paused = await runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(paused.status).toBe("paused_for_approval");
    expect(paused.pendingApprovals[0]).toMatchObject({
      kind: "budget",
      stageId: "quality-r1-review",
    });
  });
});
