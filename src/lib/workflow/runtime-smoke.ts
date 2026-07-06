import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../schema.js";
import { runFlow } from "./engine.js";
import { readEvents, type FlowEvent, type FlowState } from "./state.js";
import { getWorkerRuntime } from "./runtimes/registry.js";
import type { RuntimeHealth } from "./runtimes/base.js";

export type RuntimeSmokeOptions = {
  runtime: string;
  workspaceDir?: string;
  reportDir?: string;
  model?: string;
  keepWorkspace?: boolean;
};

export type RuntimeSmokeResult = {
  runtime: string;
  workspaceDir: string;
  reportPath: string;
  health: RuntimeHealth;
  state?: FlowState;
  events: FlowEvent[];
  artifactExists: boolean;
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "runtime";
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function smokeWorkflow(runtime: string, model?: string): WorkflowDef {
  return WorkflowDef.parse({
    max_parallel: 1,
    runtime_policy: { primary: runtime, on_rate_limit: "fail" },
    stages: [
      {
        id: "smoke",
        title: "Runtime smoke artifact",
        owner: "runtime-smoke-worker",
        outputs: ["smoke.md"],
        validators: ["required_output_exists", "non_empty_markdown"],
        ...(model ? { model } : {}),
      },
    ],
  });
}

function smokeReport(result: Omit<RuntimeSmokeResult, "reportPath">): string {
  const unit = result.state?.units.smoke;
  const lines = [
    "# MalaClaw Runtime Smoke",
    "",
    `Runtime: ${result.runtime}`,
    `Workspace: ${result.workspaceDir}`,
    `Available: ${result.health.available ? "yes" : "no"}`,
    `Headless: ${result.health.supports_headless ? "yes" : "no"}`,
    `Max concurrent: ${result.health.max_concurrent ?? "unknown"}`,
    `Isolated workspace: ${result.health.requires_isolated_workspace ? "required" : "no"}`,
    ...(result.health.detail ? [`Detail: ${result.health.detail}`] : []),
    "",
    "## Result",
    "",
    `Flow status: ${result.state?.status ?? "not_run"}`,
    `Unit status: ${unit?.status ?? "not_run"}`,
    `Last outcome: ${unit?.lastOutcome ?? "n/a"}`,
    `Attempts: ${unit?.attempts ?? 0}`,
    `Artifact smoke.md: ${result.artifactExists ? "present" : "missing"}`,
    "",
    "## Events",
    "",
  ];
  if (result.events.length === 0) lines.push("- None.");
  else {
    for (const event of result.events) {
      lines.push(`- ${event.ts ?? "no-ts"} ${event.type}${event.key ? ` (${event.key})` : ""}`);
    }
  }
  lines.push(
    "",
    "## Known Failure Modes",
    "",
    "- `rate_limited`: retry later or use another configured runtime.",
    "- `quota_exhausted`: switch runtime/model or wait for quota reset.",
    "- `permission_blocked`: adjust runtime permissions or move work to `script`.",
    "- `model_unavailable`: choose a model supported by the selected runtime.",
    "- `tool_missing`: this runtime cannot satisfy the stage shape.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export async function runRuntimeSmoke(opts: RuntimeSmokeOptions): Promise<RuntimeSmokeResult> {
  const runtime = getWorkerRuntime(opts.runtime);
  const workspaceDir = opts.workspaceDir
    ? path.resolve(opts.workspaceDir)
    : await fs.mkdtemp(path.join(os.tmpdir(), `malaclaw-smoke-${slug(opts.runtime)}-`));
  const reportDir = path.resolve(opts.reportDir ?? path.join(process.cwd(), "reports"));
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "reports"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, "README.md"),
    [
      "# MalaClaw Runtime Smoke Workspace",
      "",
      "The worker should create `smoke.md` as a non-empty Markdown artifact.",
      "Any concise content is acceptable.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const health = await runtime.checkAvailable();
  let state: FlowState | undefined;
  if (health.available) {
    state = await runFlow({
      workflow: smokeWorkflow(opts.runtime, opts.model),
      workspaceDir,
      runtime,
      reset: true,
      backoffMs: 0,
    });
  }
  const events = await readEvents(workspaceDir);
  const artifactExists = await pathExists(path.join(workspaceDir, "smoke.md"));
  const resultBase = { runtime: opts.runtime, workspaceDir, health, state, events, artifactExists };
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `runtime-smoke-${slug(opts.runtime)}-${timestamp()}.md`);
  await fs.writeFile(reportPath, smokeReport(resultBase), "utf-8");

  if (!opts.keepWorkspace && !opts.workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }

  return { ...resultBase, reportPath };
}
