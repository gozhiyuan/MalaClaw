import { describe, it, expect } from "vitest";
import {
  WorkflowStage,
  WorkflowStep,
  StandardStage,
  ForeachStage,
  LoopStage,
  WorkflowDef,
  Manifest,
} from "../src/lib/schema.js";

describe("WorkflowStage schema", () => {
  it("parses a minimal stage and applies defaults", () => {
    const stage = StandardStage.parse({ id: "intake", owner: "research-lead" });
    expect(stage.inputs).toEqual([]);
    expect(stage.optional_inputs).toEqual([]);
    expect(stage.outputs).toEqual([]);
    expect(stage.tools).toEqual([]);
    expect(stage.validators).toEqual([]);
    expect(stage.validator_commands).toEqual([]);
    expect(stage.requires_human_approval).toBe(false);
    expect(stage.retry).toBeUndefined();
  });

  it("parses a full stage", () => {
    const stage = StandardStage.parse({
      id: "draft_sections",
      title: "Draft sections",
      owner: "chapter-writer",
      inputs: ["outline.md"],
      outputs: ["chapters/*.md"],
      tools: ["web_search"],
      validators: ["required_output_exists", "citation_markers_present"],
      validator_commands: [{ cmd: "longwrite", args: ["validate", "research", "."] }],
      requires_human_approval: true,
      retry: { max_attempts: 3 },
      max_rounds: 5,
      stop_when: "review_score >= 8.0",
    });
    expect(stage.retry?.max_attempts).toBe(3);
    expect(stage.max_rounds).toBe(5);
    expect(stage.validator_commands[0].args).toContain("research");
  });

  it("defaults retry.max_attempts to 2 when retry block is present but empty", () => {
    const stage = StandardStage.parse({ id: "x", owner: "a", retry: {} });
    expect(stage.retry?.max_attempts).toBe(2);
  });

  it("rejects a stage without an owner", () => {
    expect(() => WorkflowStage.parse({ id: "intake" })).toThrow();
  });

  it("rejects an empty stage id", () => {
    expect(() => WorkflowStage.parse({ id: "", owner: "a" })).toThrow();
  });

  it("rejects unknown keys (typo protection — silently stripping a typoed approval flag would drop a safety gate)", () => {
    // Assert on StandardStage/WorkflowStep directly: union errors nest the
    // per-member issues, so the message text is not reliable through the union.
    expect(() =>
      StandardStage.parse({ id: "outline", owner: "a", requiresHumanApproval: true }),
    ).toThrow(/unrecognized key/i);
    expect(() =>
      StandardStage.parse({ id: "x", owner: "a", retry: { maxAttempts: 3 } }),
    ).toThrow(/unrecognized key/i);
    expect(() =>
      WorkflowStep.parse({ id: "s", owner: "a", requiresHumanApproval: true }),
    ).toThrow(/unrecognized key/i);
    // Through the union it still throws, just with a nested message.
    expect(() =>
      WorkflowStage.parse({ id: "outline", owner: "a", requiresHumanApproval: true }),
    ).toThrow();
  });
});

describe("ForeachStage schema", () => {
  it("parses a foreach stage with nested steps and applies defaults", () => {
    const stage = ForeachStage.parse({
      type: "foreach",
      id: "chapter_pipeline",
      foreach: "outline.chapters",
      steps: [
        { id: "draft", owner: "chapter-writer", outputs: ["chapters/{{item.id}}.md"] },
        {
          id: "review",
          owner: "continuity-reviewer",
          inputs: ["chapters/{{item.id}}.md"],
          outputs: ["reviews/{{item.id}}.md"],
        },
      ],
    });
    expect(stage.item_name).toBe("item");
    expect(stage.max_parallel).toBe(1);
    expect(stage.steps[0].inputs).toEqual([]);
    expect(stage.steps[0].optional_inputs).toEqual([]);
  });

  it("rejects a foreach stage with no steps", () => {
    expect(() =>
      ForeachStage.parse({ type: "foreach", id: "x", foreach: "outline.chapters", steps: [] }),
    ).toThrow();
  });

  it("rejects duplicate step ids within a foreach stage", () => {
    expect(() =>
      ForeachStage.parse({
        type: "foreach",
        id: "x",
        foreach: "outline.chapters",
        steps: [
          { id: "draft", owner: "a" },
          { id: "draft", owner: "b" },
        ],
      }),
    ).toThrow(/duplicate step id/i);
  });

  it("rejects unknown keys on foreach stages", () => {
    expect(() =>
      ForeachStage.parse({
        type: "foreach",
        id: "x",
        foreach: "y",
        maxParallel: 4,
        steps: [{ id: "s", owner: "a" }],
      }),
    ).toThrow(/unrecognized key/i);
  });

  it("parses through WorkflowDef alongside normal stages", () => {
    const wf = WorkflowDef.parse({
      stages: [
        { id: "outline", owner: "outline-architect", outputs: ["outline.md", "outline.json"] },
        {
          type: "foreach",
          id: "draft_sections",
          foreach: "outline.sections",
          item_name: "section",
          max_parallel: 4,
          steps: [
            {
              id: "draft",
              owner: "chapter-writer",
              inputs: ["outline.md"],
              outputs: ["chapters/{{section.id}}.md"],
            },
          ],
        },
      ],
    });
    expect(wf.stages).toHaveLength(2);
    expect(wf.max_parallel).toBe(2); // workflow-level global default
  });
});

describe("LoopStage schema", () => {
  it("parses a loop stage with child stages", () => {
    const stage = LoopStage.parse({
      type: "loop",
      id: "quality_loop",
      max_rounds: 3,
      stop_when: "review_score >= 8",
      stages: [
        { id: "review", owner: "reviewer", outputs: ["reviews/scorecard.json"] },
        { id: "revise", owner: "editor", inputs: ["reviews/scorecard.json"], outputs: ["chapters/*.md"] },
        {
          type: "foreach",
          id: "rebuild_sections",
          foreach: "outline.sections",
          steps: [{ id: "build", owner: "builder", outputs: ["sections/{{item.id}}.md"] }],
        },
      ],
    });
    expect(stage.stages).toHaveLength(3);
    expect(stage.max_rounds).toBe(3);
  });

  it("rejects duplicate child stage ids", () => {
    expect(() =>
      LoopStage.parse({
        type: "loop",
        id: "quality",
        max_rounds: 2,
        stages: [
          { id: "review", owner: "a" },
          { id: "review", owner: "b" },
        ],
      }),
    ).toThrow(/duplicate loop child/i);
  });

  it("rejects unknown keys on loop stages", () => {
    expect(() =>
      LoopStage.parse({
        type: "loop",
        id: "quality",
        maxRounds: 2,
        max_rounds: 2,
        stages: [{ id: "review", owner: "a" }],
      }),
    ).toThrow(/unrecognized key/i);
  });
});

describe("WorkflowDef schema", () => {
  it("rejects an empty stages list", () => {
    expect(() => WorkflowDef.parse({ stages: [] })).toThrow();
  });

  it("defaults external_inputs to an empty list", () => {
    const wf = WorkflowDef.parse({ stages: [{ id: "intake", owner: "a" }] });
    expect(wf.external_inputs).toEqual([]);
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      WorkflowDef.parse({ stages: [{ id: "intake", owner: "a" }], artifactType: "paper" }),
    ).toThrow(/unrecognized key/i);
  });

  it("rejects duplicate stage ids", () => {
    expect(() =>
      WorkflowDef.parse({
        stages: [
          { id: "intake", owner: "a" },
          { id: "intake", owner: "b" },
        ],
      }),
    ).toThrow(/duplicate stage id/i);
  });

  it("parses an AutoResearch-V2-lite-shaped workflow", () => {
    const wf = WorkflowDef.parse({
      mode: "auto_research_v2_lite",
      artifact_type: "research_paper",
      stages: [
        { id: "intake", owner: "research-lead", outputs: ["project_brief.md"] },
        {
          id: "recall",
          owner: "source-curator",
          inputs: ["project_brief.md"],
          tools: ["web_search", "arxiv_search"],
          outputs: ["sources/raw_results.jsonl"],
        },
        {
          id: "outline",
          owner: "outline-architect",
          inputs: ["project_brief.md"],
          outputs: ["outline.md"],
          requires_human_approval: true,
        },
      ],
    });
    expect(wf.stages).toHaveLength(3);
    expect(wf.stages[2].requires_human_approval).toBe(true);
  });
});

describe("Manifest workflow field", () => {
  it("parses a manifest without workflow (backward compat)", () => {
    const manifest = Manifest.parse({ version: 1 });
    expect(manifest.workflow).toBeUndefined();
  });

  it("parses a manifest with a workflow", () => {
    const manifest = Manifest.parse({
      version: 1,
      runtime: "codex",
      packs: [{ id: "manuscript-writing" }],
      workflow: {
        mode: "auto_research_v2_lite",
        stages: [{ id: "intake", owner: "research-lead" }],
      },
    });
    expect(manifest.workflow?.stages[0].id).toBe("intake");
  });

  it("rejects a manifest whose workflow has invalid stages", () => {
    expect(() =>
      Manifest.parse({
        version: 1,
        workflow: { stages: [{ id: "intake" }] }, // missing owner
      }),
    ).toThrow();
  });
});
