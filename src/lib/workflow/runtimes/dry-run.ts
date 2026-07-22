import fs from "node:fs/promises";
import path from "node:path";
import type { StageRunOutcome } from "../../schema.js";
import { resolveWithin } from "../safe-paths.js";
import type { RuntimeHealth, StageRunRequest, StageRunResult, WorkerRuntime } from "./base.js";
import { CLI_HARNESS_CAPABILITIES } from "./base.js";

export type DryRunOptions = {
  /** Exact content for specific output paths. */
  fixtures?: Record<string, string>;
  /** Scripted outcome queues per unit key; once drained, runs succeed. */
  outcomes?: Record<string, StageRunOutcome[]>;
  /** Deterministic artifact/runtime faults, consumed once per unit invocation.
   * Tests use this to exercise the same retry and validator boundaries that
   * variable model output reaches in live runs. */
  faults?: Record<string, DryRunFault[]>;
};

export type DryRunFault =
  | "throw"
  | "omit_outputs"
  | "empty_outputs"
  | "truncated_json"
  | "unchanged_outputs";

function isConcrete(outputPath: string): boolean {
  return !outputPath.includes("*") && !outputPath.includes("{{");
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Deterministic runtime for tests, CI, and workflow dry runs. Writes every
 *  concrete declared output (fixture content or a placeholder) and never
 *  calls a model. */
export class DryRunRuntime implements WorkerRuntime {
  readonly id = "dry-run";
  // A simulator accepts every contract: workflows written for harness
  // runtimes must stay dry-runnable in CI.
  readonly capabilities = CLI_HARNESS_CAPABILITIES;
  private readonly fixtures: Record<string, string>;
  private readonly outcomes: Record<string, StageRunOutcome[]>;
  private readonly faults: Record<string, DryRunFault[]>;

  constructor(options: DryRunOptions = {}) {
    this.fixtures = options.fixtures ?? {};
    this.outcomes = structuredClone(options.outcomes ?? {});
    this.faults = structuredClone(options.faults ?? {});
  }

  async checkAvailable(): Promise<RuntimeHealth> {
    return { available: true, supports_headless: true, max_concurrent: 8 };
  }

  async runStage(req: StageRunRequest): Promise<StageRunResult> {
    const fault = this.faults[req.unitKey]?.shift();
    if (fault === "throw") throw new Error(`scripted runtime throw for ${req.unitKey}`);
    if (fault === "omit_outputs" || fault === "unchanged_outputs") {
      return { outcome: "success", producedFiles: [] };
    }
    const scripted = this.outcomes[req.unitKey]?.shift();
    if (scripted && scripted !== "success") {
      return { outcome: scripted, producedFiles: [], message: `scripted ${scripted}` };
    }

    const produced: string[] = [];
    for (const output of req.outputs) {
      if (!isConcrete(output)) continue; // unresolved templates/globs are never written
      // Never write outside the workspace, whatever the manifest says.
      const filePath = resolveWithin(req.workspaceDir, output);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // Workspace-provided fixtures let domain layers make dry runs satisfy
      // their own external validators without this runtime knowing anything
      // about them. Unit-scoped fixtures (units/<unitKey>/<output>) beat the
      // shared ones so loop rounds can produce different content — e.g. a
      // review scorecard that improves across quality-loop rounds.
      const fixturesRoot = path.join(req.workspaceDir, ".malaclaw", "fixtures");
      const unitFixture = await readIfExists(
        resolveWithin(path.join(fixturesRoot, "units", req.unitKey), output),
      );
      const workspaceFixture =
        unitFixture ?? (await readIfExists(resolveWithin(fixturesRoot, output)));
      const normalContent =
        this.fixtures[output] ??
        workspaceFixture ??
        (output.endsWith(".jsonl")
          ? "{}\n"
          : output.endsWith(".json")
          ? JSON.stringify({
              sections: [{ id: "section-1" }, { id: "section-2" }],
              chapters: [{ id: "chapter-1" }, { id: "chapter-2" }],
              items: [{ id: "item-1" }, { id: "item-2" }],
            }, null, 2)
          : null) ??
        `# dry-run artifact\nunit: ${req.unitKey}\nowner: ${req.owner}\n`;
      const content = fault === "empty_outputs"
        ? ""
        : fault === "truncated_json" && /\.jsonl?$/.test(output)
          ? '{"truncated":'
          : normalContent;
      await fs.writeFile(filePath, content, "utf-8");
      produced.push(output);
    }
    return { outcome: "success", producedFiles: produced };
  }
}
