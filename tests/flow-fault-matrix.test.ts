import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow } from "../src/lib/workflow/engine.js";
import { DryRunRuntime, type DryRunFault } from "../src/lib/workflow/runtimes/dry-run.js";
import { readFlowFailures, type FailureClass } from "../src/lib/workflow/failures.js";

const tempDirs: string[] = [];
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

type Case = {
  fault: DryRunFault;
  output: string;
  validators: string[];
  expectedClass: FailureClass;
  seed?: string;
};

const cases: Case[] = [
  { fault: "omit_outputs", output: "plan.md", validators: ["required_output_exists"], expectedClass: "llm_contract" },
  { fault: "empty_outputs", output: "plan.md", validators: ["required_output_exists", "non_empty_markdown"], expectedClass: "llm_contract" },
  { fault: "truncated_json", output: "evidence.jsonl", validators: ["required_output_exists", "jsonl_parseable"], expectedClass: "llm_contract" },
  { fault: "unchanged_outputs", output: "plan.md", validators: ["required_output_exists"], expectedClass: "llm_contract", seed: "stale plan" },
  { fault: "throw", output: "plan.md", validators: ["required_output_exists"], expectedClass: "unknown" },
];

describe("adversarial stage-output fault matrix", () => {
  for (const testCase of cases) {
    it(`recovers from ${testCase.fault} with validator feedback and a fresh second attempt`, async () => {
      const ws = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-fault-matrix-"));
      tempDirs.push(ws);
      if (testCase.seed !== undefined) await fs.writeFile(path.join(ws, testCase.output), testCase.seed, "utf-8");
      const workflow = WorkflowDef.parse({
        stages: [{
          id: "stage", owner: "tester", outputs: [testCase.output],
          validators: testCase.validators, retry: { max_attempts: 2 },
        }],
      });
      const state = await runFlow({
        workflow, workspaceDir: ws,
        runtime: new DryRunRuntime({ faults: { stage: [testCase.fault] } }),
      });
      expect(state.status).toBe("completed");
      expect(state.units.stage.attempts).toBe(2);
      const failures = await readFlowFailures(ws);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        stage: "stage", attempt: 1, failure_class: testCase.expectedClass, recoverable: true,
      });
      const retryPrompt = await fs.readFile(
        path.join(ws, ".malaclaw", "flow", "prompts", "stage-attempt2.md"), "utf-8",
      );
      expect(retryPrompt).toContain("Previous attempt failed");
    });
  }

  it("allows an explicitly declared unchanged pass-through output", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-fault-matrix-"));
    tempDirs.push(ws);
    await fs.writeFile(path.join(ws, "corpus.jsonl"), "{}\n", "utf-8");
    const workflow = WorkflowDef.parse({
      stages: [{
        id: "enrich", owner: "tester", inputs: ["corpus.jsonl"], outputs: ["corpus.jsonl"],
        allow_unchanged_outputs: ["corpus.jsonl"], validators: ["required_output_exists", "jsonl_parseable"],
      }],
    });
    const state = await runFlow({
      workflow, workspaceDir: ws,
      runtime: new DryRunRuntime({ faults: { enrich: ["unchanged_outputs"] } }),
    });
    expect(state.status).toBe("completed");
    expect(await readFlowFailures(ws)).toEqual([]);
  });
});
