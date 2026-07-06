import { describe, it, expect } from "vitest";
import { StandardStage } from "../src/lib/schema.js";
import { renderUnitPrompt } from "../src/lib/workflow/prompt.js";

describe("renderUnitPrompt", () => {
  const stage = StandardStage.parse({
    id: "draft",
    title: "Draft the plan",
    owner: "pm",
    inputs: ["notes.md"],
    optional_inputs: ["refs.bib"],
    outputs: ["plan.md"],
    tools: ["read_file", "write_file"],
    validators: ["required_output_exists"],
    validator_commands: [{ cmd: "longwrite", args: ["validate", "research", "."] }],
  });

  it("renders the full stage contract", () => {
    const prompt = renderUnitPrompt({ stage, unitKey: "draft" });
    expect(prompt).toContain("Stage: draft");
    expect(prompt).toContain("Owner: pm");
    expect(prompt).toContain("- notes.md");
    expect(prompt).toContain("Optional inputs");
    expect(prompt).toContain("- refs.bib");
    expect(prompt).toContain("Required outputs");
    expect(prompt).toContain("- plan.md");
    expect(prompt).toContain("- read_file");
    expect(prompt).toContain("External validator commands");
    expect(prompt).toContain("longwrite validate research .");
    expect(prompt).toContain("blocker");
  });

  it("appends retry feedback when provided", () => {
    const prompt = renderUnitPrompt({
      stage,
      unitKey: "draft",
      retryFeedback: ['required_output_exists: "plan.md" was not produced'],
    });
    expect(prompt).toContain("Previous attempt failed");
    expect(prompt).toContain("plan.md");
  });
});
