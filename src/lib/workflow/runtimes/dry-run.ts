import fs from "node:fs/promises";
import path from "node:path";
import type { StageRunOutcome } from "../../schema.js";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";

export type DryRunOptions = {
  /** Exact content for specific output paths. */
  fixtures?: Record<string, string>;
  /** Scripted outcome queues per unit key; once drained, runs succeed. */
  outcomes?: Record<string, StageRunOutcome[]>;
};

function isConcrete(outputPath: string): boolean {
  return !outputPath.includes("*") && !outputPath.includes("{{");
}

/** Deterministic runtime for tests, CI, and workflow dry runs. Writes every
 *  concrete declared output (fixture content or a placeholder) and never
 *  calls a model. */
export class DryRunRuntime implements WorkerRuntime {
  readonly id = "dry-run";
  private readonly fixtures: Record<string, string>;
  private readonly outcomes: Record<string, StageRunOutcome[]>;

  constructor(options: DryRunOptions = {}) {
    this.fixtures = options.fixtures ?? {};
    this.outcomes = structuredClone(options.outcomes ?? {});
  }

  async checkAvailable(): Promise<RuntimeHealth> {
    return { available: true, supports_headless: true, max_concurrent: 8 };
  }

  async runStage(req: StageRunRequest): Promise<StageRunResult> {
    const scripted = this.outcomes[req.unitKey]?.shift();
    if (scripted && scripted !== "success") {
      return { outcome: scripted, producedFiles: [], message: `scripted ${scripted}` };
    }

    const produced: string[] = [];
    for (const output of req.outputs) {
      if (!isConcrete(output)) continue; // foreach templates arrive in M2b
      const filePath = path.join(req.workspaceDir, output);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const content =
        this.fixtures[output] ??
        (output.endsWith(".json")
          ? JSON.stringify({
              sections: [{ id: "section-1" }, { id: "section-2" }],
              chapters: [{ id: "chapter-1" }, { id: "chapter-2" }],
              items: [{ id: "item-1" }, { id: "item-2" }],
            }, null, 2)
          : null) ??
        `# dry-run artifact\nunit: ${req.unitKey}\nowner: ${req.owner}\n`;
      await fs.writeFile(filePath, content, "utf-8");
      produced.push(output);
    }
    return { outcome: "success", producedFiles: produced };
  }
}
