import { describe, it, expect } from "vitest";
import { WorkflowDef } from "../src/lib/schema.js";
import {
  validateWorkflowSemantics,
  matchesArtifact,
} from "../src/lib/workflow/validate.js";

const owners = new Set(["research-lead", "source-curator", "chapter-writer"]);

describe("matchesArtifact", () => {
  it("matches identical paths", () => {
    expect(matchesArtifact("outline.md", "outline.md")).toBe(true);
  });

  it("matches a glob output against a concrete input", () => {
    expect(matchesArtifact("chapters/*.md", "chapters/chapter-01.md")).toBe(true);
  });

  it("matches a concrete output against a glob input", () => {
    expect(matchesArtifact("chapters/chapter-01.md", "chapters/*.md")).toBe(true);
  });

  it("does not match unrelated paths", () => {
    expect(matchesArtifact("outline.md", "sources/raw.jsonl")).toBe(false);
  });

  it("treats {{item}} templates as wildcards", () => {
    expect(matchesArtifact("chapters/{{section.id}}.md", "chapters/chapter-01.md")).toBe(true);
    expect(matchesArtifact("chapters/{{section.id}}.md", "chapters/*.md")).toBe(true);
    expect(matchesArtifact("chapters/{{section.id}}.md", "reviews/chapter-01.md")).toBe(false);
  });
});

describe("validateWorkflowSemantics", () => {
  it("accepts a workflow whose owners all exist", () => {
    const wf = WorkflowDef.parse({
      stages: [
        { id: "intake", owner: "research-lead", outputs: ["project_brief.md"] },
        { id: "recall", owner: "source-curator", inputs: ["project_brief.md"] },
      ],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("errors on an unknown stage owner", () => {
    const wf = WorkflowDef.parse({
      stages: [{ id: "intake", owner: "ghost-writer" }],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"ghost-writer"');
    expect(result.errors[0]).toContain('"intake"');
  });

  it("warns when an input is not produced by any earlier stage", () => {
    const wf = WorkflowDef.parse({
      stages: [
        { id: "intake", owner: "research-lead", outputs: ["project_brief.md"] },
        { id: "review", owner: "chapter-writer", inputs: ["chapters/chapter-01.md"] },
      ],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("chapters/chapter-01.md");
  });

  it("does not warn when a glob output covers a later concrete input", () => {
    const wf = WorkflowDef.parse({
      stages: [
        { id: "draft", owner: "chapter-writer", outputs: ["chapters/*.md"] },
        { id: "review", owner: "research-lead", inputs: ["chapters/chapter-01.md"] },
      ],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.warnings).toEqual([]);
  });

  it("does not treat a stage's own outputs as available inputs", () => {
    const wf = WorkflowDef.parse({
      stages: [
        { id: "revise", owner: "chapter-writer", inputs: ["chapters/*.md"], outputs: ["chapters/*.md"] },
      ],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.warnings).toHaveLength(1);
  });

  it("does not warn for inputs declared in external_inputs", () => {
    const wf = WorkflowDef.parse({
      external_inputs: ["sources/bibliography.bib"],
      stages: [
        { id: "build", owner: "chapter-writer", inputs: ["sources/bibliography.bib"] },
      ],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.warnings).toEqual([]);
  });

  it("never warns about optional_inputs (used if present, never required)", () => {
    const wf = WorkflowDef.parse({
      stages: [
        {
          id: "build",
          owner: "chapter-writer",
          inputs: [],
          optional_inputs: ["sources/bibliography.bib"],
        },
      ],
    });
    const result = validateWorkflowSemantics(wf, owners);
    expect(result.warnings).toEqual([]);
  });

  it("validates owners and provenance inside foreach steps", () => {
    const wf = WorkflowDef.parse({
      stages: [
        { id: "outline", owner: "research-lead", outputs: ["outline.json"] },
        {
          type: "foreach",
          id: "chapters",
          foreach: "outline.chapters",
          steps: [
            { id: "draft", owner: "chapter-writer", outputs: ["chapters/{{item.id}}.md"] },
            {
              id: "review",
              owner: "ghost-reviewer",
              inputs: ["chapters/{{item.id}}.md"],
              outputs: ["reviews/{{item.id}}.md"],
            },
          ],
        },
      ],
    });
    const result = validateWorkflowSemantics(wf, owners);
    // Unknown step owner is an error, labeled stage.step.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('"chapters.review"');
    expect(result.errors[0]).toContain('"ghost-reviewer"');
    // The draft step's templated output satisfies the review step's input.
    expect(result.warnings).toEqual([]);
  });
});
