import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendFlowFailure,
  readFlowFailures,
  runtimeFailureClass,
  validationFailureClass,
} from "../src/lib/workflow/failures.js";

const tempDirs: string[] = [];
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe("classified flow failures", () => {
  it("writes append-only schema-validated NDJSON", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-failures-"));
    tempDirs.push(ws);
    await appendFlowFailure(ws, {
      stage: "semantic_screen", attempt: 1, failure_class: "llm_contract",
      code: "schema_invalid", message: "missing selected_source_ids",
      remediation: "Retry with the schema findings.", recoverable: true,
    });
    await appendFlowFailure(ws, {
      stage: "corpus_gates", failure_class: "evidence_quality",
      code: "coverage_below_target", message: "A-depth coverage below target",
      remediation: "Enter bounded evidence recovery.", recoverable: true,
    });
    expect(await readFlowFailures(ws)).toEqual([
      expect.objectContaining({ stage: "semantic_screen", failure_class: "llm_contract" }),
      expect.objectContaining({ stage: "corpus_gates", failure_class: "evidence_quality" }),
    ]);
  });

  it("classifies boundary failures consistently", () => {
    expect(validationFailureClass("codex", ["schema is invalid"])).toBe("llm_contract");
    expect(validationFailureClass("script", ["required_output_exists: missing"])).toBe("deterministic_contract");
    expect(validationFailureClass("script", ["accepted-source ratio below target"])).toBe("evidence_quality");
    expect(runtimeFailureClass("quota_exhausted")).toBe("external_environment");
    expect(runtimeFailureClass("cancelled")).toBe("operator_state");
    expect(runtimeFailureClass("worker_error")).toBe("unknown");
  });
});
