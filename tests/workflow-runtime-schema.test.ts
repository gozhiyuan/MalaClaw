import { describe, it, expect } from "vitest";
import { ModelTier, RuntimePolicy, StageRunOutcome, WorkflowDef, StandardStage } from "../src/lib/schema.js";
import { validateWorkflowSemantics } from "../src/lib/workflow/validate.js";

const owners = new Set(["pm", "tech-lead"]);

describe("StageRunOutcome", () => {
  it("accepts all classified outcomes", () => {
    for (const o of [
      "success", "validation_failed", "worker_error", "timeout",
      "rate_limited", "quota_exhausted", "permission_blocked",
      "tool_missing", "model_unavailable", "budget_exceeded",
    ]) {
      expect(StageRunOutcome.parse(o)).toBe(o);
    }
  });

  it("rejects unknown outcomes", () => {
    expect(() => StageRunOutcome.parse("exploded")).toThrow();
  });
});

describe("ModelTier and RuntimePolicy", () => {
  it("parses a tier with defaults", () => {
    const tier = ModelTier.parse({ runtime: "claude-code" });
    expect(tier.requires_budget_approval).toBe(false);
  });

  it("parses a runtime policy with defaults", () => {
    const policy = RuntimePolicy.parse({});
    expect(policy.primary).toBe("dry-run");
    expect(policy.fallback).toEqual([]);
    expect(policy.on_rate_limit).toBe("backoff");
    expect(policy.on_quota_exhausted).toBe("pause");
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => ModelTier.parse({ runtime: "x", maxCostUsd: 1 })).toThrow(/unrecognized key/i);
    expect(() => RuntimePolicy.parse({ onRateLimit: "backoff" })).toThrow(/unrecognized key/i);
  });
});

describe("workflow-level runtime config", () => {
  it("parses model_tiers, runtime_policy, and budget_usd", () => {
    const wf = WorkflowDef.parse({
      runtime_policy: { primary: "dry-run", fallback: ["codex"] },
      model_tiers: { cheap: { runtime: "openai-api", max_cost_usd: 0.25 } },
      budget_usd: 20,
      stages: [{ id: "plan", owner: "pm", model_tier: "cheap" }],
    });
    expect(wf.model_tiers?.cheap.max_cost_usd).toBe(0.25);
    expect(wf.budget_usd).toBe(20);
  });

  it("parses stage-level runtime/model overrides", () => {
    const stage = StandardStage.parse({ id: "x", owner: "pm", runtime: "codex", model: "some-model" });
    expect(stage.runtime).toBe("codex");
    expect(stage.model).toBe("some-model");
  });

  it("errors when a stage references an undefined model_tier", () => {
    const wf = WorkflowDef.parse({
      model_tiers: { cheap: { runtime: "openai-api" } },
      stages: [{ id: "plan", owner: "pm", model_tier: "strong" }],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"strong"');
  });

  it("accepts a stage referencing a defined model_tier", () => {
    const wf = WorkflowDef.parse({
      model_tiers: { cheap: { runtime: "openai-api" } },
      stages: [{ id: "plan", owner: "pm", model_tier: "cheap" }],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.errors).toEqual([]);
  });
});
