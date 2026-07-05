# MalaClaw Flow Engine Core (Milestone 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `malaclaw flow run` that executes *sequential* workflow stages through a pluggable `WorkerRuntime` (DryRunRuntime first), with file-backed resumable state, events, checkpoints, built-in validators, retry-with-feedback, approval gates, and classified outcomes (rate-limit backoff, quota/blocker pauses). Foreach scheduling and the review queue land in the next plan (M2b).

**Architecture:** Everything new lives under `src/lib/workflow/` (the module M1 started) plus one CLI command file. The engine is deterministic TypeScript: it renders a prompt contract to a file, hands it to a `WorkerRuntime`, verifies the contract (outputs + validators), and records every transition in `.malaclaw/flow/` state/events. Workers are black boxes. Runtime/model/tier/budget/fallback *schema* lands here (deferred from M1); budget *enforcement* and real runtimes come later.

**Tech Stack:** TypeScript, Zod v3, Vitest 4, commander. Node ≥ 22. All work in the MalaClaw repo on branch `workflow-schema`.

**Spec:** `longwrite-agent/docs/superpowers/specs/2026-07-04-longwrite-malaclaw-flows-design.md` §3–§4, Milestone 2.

**Working conventions:** `npm run build` before CLI smoke tests; targeted tests via `npx vitest run tests/<file>.test.ts`; snake_case YAML fields.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/lib/schema.ts` | Modify | `StageRunOutcome`, `ModelTier`, `RuntimePolicy`; `WorkflowDef` gains `runtime_policy`, `model_tiers`, `budget_usd`; work units gain `runtime`/`model`/`model_tier` |
| `src/lib/workflow/validate.ts` | Modify | Semantic check: `model_tier` references must exist |
| `src/lib/workflow/state.ts` | Create | `FlowState` schema, load/init/save, `appendEvent`, `workflowHash`, flow dir paths |
| `src/lib/workflow/runtimes/base.ts` | Create | `WorkerRuntime`, `StageRunRequest`, `StageRunResult`, `RuntimeHealth` types |
| `src/lib/workflow/runtimes/registry.ts` | Create | `registerWorkerRuntime` / `getWorkerRuntime` (separate from install-time adapter registry) |
| `src/lib/workflow/runtimes/dry-run.ts` | Create | Deterministic `DryRunRuntime` with fixtures + scripted outcomes for tests/CI |
| `src/lib/workflow/validators.ts` | Create | Built-ins: `required_output_exists`, `non_empty_markdown`, `jsonl_parseable`; fail-closed on unknown names |
| `src/lib/workflow/prompt.ts` | Create | Render the stage contract prompt text |
| `src/lib/workflow/engine.ts` | Create | `runFlow`, `approveFlow`, `getFlowStatus` — the deterministic stage loop |
| `src/commands/flow.ts` | Create | `malaclaw flow run/status/approve/report` |
| `src/cli.ts` | Modify | Register the `flow` command group |
| `tests/workflow-runtime-schema.test.ts` | Create | Tier/policy schema + semantic tier validation |
| `tests/flow-state.test.ts` | Create | State init/save/load/hash/events |
| `tests/dry-run-runtime.test.ts` | Create | DryRunRuntime fixtures, outcomes queue, health |
| `tests/flow-validators.test.ts` | Create | Built-in validators, unknown-name fail-closed |
| `tests/flow-prompt.test.ts` | Create | Prompt contract rendering |
| `tests/flow-engine.test.ts` | Create | Happy path, retry-with-feedback, approval pause/approve/resume, rate-limit backoff, quota blocker pause, resume-after-interrupt, checkpoint |
| `CLAUDE.md` / `README.md` | Modify | Flow engine docs rows |

State layout created in a project workspace:

```text
<workspace>/.malaclaw/flow/
  state.json        # FlowState — current unit statuses, approvals, hash
  events.jsonl      # append-only transition log
  checkpoints/      # <ts>-<unitKey>/<artifact> copies before overwrite
  prompts/          # <unitKey>-attempt<N>.md rendered contracts
  logs/             # <unitKey>-attempt<N>.log worker output (real runtimes)
<workspace>/reports/
  validation.md     # appended validator reports
  <unitKey>-blocker.md  # written when a unit pauses the flow
```

---

### Task 1: Runtime/Model/Tier Schema (deferred from M1)

**Files:**
- Test: `tests/workflow-runtime-schema.test.ts`
- Modify: `src/lib/schema.ts`, `src/lib/workflow/validate.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/workflow-runtime-schema.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/workflow-runtime-schema.test.ts`
Expected: FAIL — `ModelTier`, `RuntimePolicy`, `StageRunOutcome` not exported.

- [ ] **Step 3: Implement schema additions**

In `src/lib/schema.ts`, inside the workflow section (after `WorkflowRetry`, before `workUnitFields`), add:

```ts
// Classified worker outcomes so the scheduler can act deterministically
// instead of treating every failure as a generic error.
export const StageRunOutcome = z.enum([
  "success",
  "validation_failed",
  "worker_error",
  "timeout",
  "rate_limited",
  "quota_exhausted",
  "permission_blocked",
  "tool_missing",
  "model_unavailable",
  "budget_exceeded",
]);

// A named model tier maps cheap/balanced/strong work to a runtime + model.
export const ModelTier = z
  .object({
    runtime: z.string().min(1),
    model: z.string().optional(),
    max_cost_usd: z.number().positive().optional(),
    requires_budget_approval: z.boolean().default(false),
  })
  .strict();

// Explicit runtime selection + failure policy. Fallback is never silent:
// the engine records requested vs actual runtime/model in state and events.
export const RuntimePolicy = z
  .object({
    primary: z.string().min(1).default("dry-run"),
    fallback: z.array(z.string()).default([]),
    on_rate_limit: z.enum(["backoff", "fail"]).default("backoff"),
    on_quota_exhausted: z.enum(["try_fallback", "pause"]).default("pause"),
    on_budget_exceeded: z.enum(["require_approval", "pause"]).default("require_approval"),
  })
  .strict();
```

Add three optional fields to `workUnitFields` (after `retry`):

```ts
  // Runtime/model selection overrides. Resolution order:
  // unit override -> model_tier -> workflow runtime_policy.primary.
  runtime: z.string().optional(),
  model: z.string().optional(),
  model_tier: z.string().optional(),
```

Add three fields to `WorkflowDef` (after `max_parallel`):

```ts
    runtime_policy: RuntimePolicy.optional(),
    model_tiers: z.record(ModelTier).optional(),
    // Soft budget for the whole flow; enforcement arrives with real runtimes.
    budget_usd: z.number().positive().optional(),
```

Add type exports next to the other workflow types:

```ts
export type StageRunOutcome = z.infer<typeof StageRunOutcome>;
export type ModelTier = z.infer<typeof ModelTier>;
export type RuntimePolicy = z.infer<typeof RuntimePolicy>;
```

- [ ] **Step 4: Add the tier-reference semantic check**

In `src/lib/workflow/validate.ts`, extend `toWorkUnits`'s `WorkUnit` type and the semantics function. Change the `WorkUnit` type and `toWorkUnits` to carry `modelTier`:

```ts
type WorkUnit = {
  label: string;
  owner: string;
  inputs: string[];
  outputs: string[];
  modelTier?: string;
};
```

In `toWorkUnits`, add `modelTier: step.model_tier` to the foreach branch's mapped object and `modelTier: stage.model_tier` to the normal-stage object.

In `validateWorkflowSemantics`, inside the per-unit loop (after the owner check), add:

```ts
      if (unit.modelTier && !(workflow.model_tiers && unit.modelTier in workflow.model_tiers)) {
        errors.push(
          `Stage "${unit.label}": model_tier "${unit.modelTier}" is not defined in workflow.model_tiers`,
        );
      }
```

- [ ] **Step 5: Run tests to verify they pass, then the full suite**

Run: `npx vitest run tests/workflow-runtime-schema.test.ts` → PASS.
Run: `npm test` → PASS (existing workflow tests unaffected: new fields are optional).

- [ ] **Step 6: Commit**

```bash
git add src/lib/schema.ts src/lib/workflow/validate.ts tests/workflow-runtime-schema.test.ts
git commit -m "feat: add runtime/model tier, policy, budget, and outcome schemas"
```

---

### Task 2: Flow State Module

**Files:**
- Test: `tests/flow-state.test.ts`
- Create: `src/lib/workflow/state.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/flow-state.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import {
  initFlowState,
  loadFlowState,
  saveFlowState,
  appendEvent,
  readEvents,
  workflowHash,
  flowDir,
} from "../src/lib/workflow/state.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-flow-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

const wf = WorkflowDef.parse({
  stages: [
    { id: "plan", owner: "pm", outputs: ["plan.md"] },
    { id: "build", owner: "tech-lead", inputs: ["plan.md"], requires_human_approval: true },
  ],
});

describe("flow state", () => {
  it("initializes one pending unit per sequential stage", async () => {
    const ws = await makeWorkspace();
    const state = await initFlowState(wf, ws);
    expect(state.status).toBe("idle");
    expect(Object.keys(state.units)).toEqual(["plan", "build"]);
    expect(state.units.plan.status).toBe("pending");
    expect(state.workflowHash).toBe(workflowHash(wf));
  });

  it("round-trips through save/load", async () => {
    const ws = await makeWorkspace();
    const state = await initFlowState(wf, ws);
    state.units.plan.status = "succeeded";
    state.status = "running";
    await saveFlowState(ws, state);
    const loaded = await loadFlowState(ws);
    expect(loaded?.units.plan.status).toBe("succeeded");
    expect(loaded?.status).toBe("running");
  });

  it("returns null when no state exists", async () => {
    const ws = await makeWorkspace();
    expect(await loadFlowState(ws)).toBeNull();
  });

  it("changes hash when the workflow changes", () => {
    const wf2 = WorkflowDef.parse({ stages: [{ id: "plan", owner: "pm" }] });
    expect(workflowHash(wf)).not.toBe(workflowHash(wf2));
  });

  it("appends and reads events", async () => {
    const ws = await makeWorkspace();
    await initFlowState(wf, ws);
    await appendEvent(ws, { type: "unit_started", key: "plan" });
    await appendEvent(ws, { type: "unit_succeeded", key: "plan" });
    const events = await readEvents(ws);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("unit_started");
    expect(events[0].ts).toBeTruthy();
  });

  it("keeps state under .malaclaw/flow/", async () => {
    const ws = await makeWorkspace();
    await initFlowState(wf, ws);
    const stat = await fs.stat(path.join(flowDir(ws), "state.json"));
    expect(stat.isFile()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/flow-state.test.ts` → module not found.

- [ ] **Step 3: Implement `src/lib/workflow/state.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { StageRunOutcome, type WorkflowDef } from "../schema.js";

export const UnitState = z.object({
  status: z.enum(["pending", "running", "succeeded", "failed"]).default("pending"),
  attempts: z.number().int().default(0),
  lastOutcome: StageRunOutcome.optional(),
  lastError: z.string().optional(),
  requestedRuntime: z.string().optional(),
  actualRuntime: z.string().optional(),
});
export type UnitState = z.infer<typeof UnitState>;

export const PendingApproval = z.object({
  id: z.string(),
  stageId: z.string(),
  artifacts: z.array(z.string()).default([]),
});
export type PendingApproval = z.infer<typeof PendingApproval>;

export const FlowState = z.object({
  version: z.number().default(1),
  workflowHash: z.string(),
  status: z.enum([
    "idle",
    "running",
    "paused_for_approval",
    "paused_blocker",
    "completed",
    "failed",
  ]).default("idle"),
  units: z.record(UnitState),
  pendingApprovals: z.array(PendingApproval).default([]),
  updatedAt: z.string(),
});
export type FlowState = z.infer<typeof FlowState>;

export function flowDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".malaclaw", "flow");
}
export function promptsDir(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "prompts");
}
export function logsDir(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "logs");
}
export function checkpointsDir(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "checkpoints");
}
function statePath(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "state.json");
}
function eventsPath(workspaceDir: string): string {
  return path.join(flowDir(workspaceDir), "events.jsonl");
}

/** Stable hash of the workflow definition so a changed manifest is detected. */
export function workflowHash(workflow: WorkflowDef): string {
  return crypto.createHash("sha256").update(JSON.stringify(workflow)).digest("hex").slice(0, 16);
}

export async function initFlowState(workflow: WorkflowDef, workspaceDir: string): Promise<FlowState> {
  const units: Record<string, UnitState> = {};
  for (const stage of workflow.stages) {
    // M2a: sequential stages only; foreach expansion arrives in M2b.
    units[stage.id] = UnitState.parse({});
  }
  const state: FlowState = FlowState.parse({
    workflowHash: workflowHash(workflow),
    units,
    updatedAt: new Date().toISOString(),
  });
  await saveFlowState(workspaceDir, state);
  return state;
}

export async function saveFlowState(workspaceDir: string, state: FlowState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fs.mkdir(flowDir(workspaceDir), { recursive: true });
  await fs.writeFile(statePath(workspaceDir), JSON.stringify(state, null, 2), "utf-8");
}

export async function loadFlowState(workspaceDir: string): Promise<FlowState | null> {
  try {
    const raw = await fs.readFile(statePath(workspaceDir), "utf-8");
    return FlowState.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export type FlowEvent = {
  ts?: string;
  type: string;
  key?: string;
  [extra: string]: unknown;
};

export async function appendEvent(workspaceDir: string, event: FlowEvent): Promise<void> {
  await fs.mkdir(flowDir(workspaceDir), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  await fs.appendFile(eventsPath(workspaceDir), line + "\n", "utf-8");
}

export async function readEvents(workspaceDir: string): Promise<FlowEvent[]> {
  try {
    const raw = await fs.readFile(eventsPath(workspaceDir), "utf-8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as FlowEvent);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/flow-state.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow/state.ts tests/flow-state.test.ts
git commit -m "feat: add file-backed flow state, events, and checkpoint paths"
```

---

### Task 3: WorkerRuntime Contract + Registry + DryRunRuntime

**Files:**
- Test: `tests/dry-run-runtime.test.ts`
- Create: `src/lib/workflow/runtimes/base.ts`, `src/lib/workflow/runtimes/registry.ts`, `src/lib/workflow/runtimes/dry-run.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/dry-run-runtime.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { getWorkerRuntime, registerWorkerRuntime } from "../src/lib/workflow/runtimes/registry.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-dry-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

function request(workspaceDir: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceDir,
    unitKey: "plan",
    owner: "pm",
    instructions: "Write the plan.",
    outputs: ["plan.md"],
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("DryRunRuntime", () => {
  it("reports healthy and headless", async () => {
    const rt = new DryRunRuntime();
    const health = await rt.checkAvailable();
    expect(health.available).toBe(true);
    expect(health.supports_headless).toBe(true);
  });

  it("writes each declared output deterministically", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime();
    const result = await rt.runStage(request(ws, { outputs: ["plan.md", "notes/decisions.md"] }));
    expect(result.outcome).toBe("success");
    expect(result.producedFiles).toEqual(["plan.md", "notes/decisions.md"]);
    const content = await fs.readFile(path.join(ws, "plan.md"), "utf-8");
    expect(content).toContain("dry-run");
    expect(content).toContain("plan");
    const nested = await fs.readFile(path.join(ws, "notes/decisions.md"), "utf-8");
    expect(nested.length).toBeGreaterThan(0);
  });

  it("uses fixture content when provided", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime({ fixtures: { "plan.md": "# The Real Plan" } });
    await rt.runStage(request(ws));
    const content = await fs.readFile(path.join(ws, "plan.md"), "utf-8");
    expect(content).toBe("# The Real Plan");
  });

  it("plays scripted outcomes per unit before succeeding", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime({ outcomes: { plan: ["rate_limited", "success"] } });
    const first = await rt.runStage(request(ws));
    expect(first.outcome).toBe("rate_limited");
    const second = await rt.runStage(request(ws));
    expect(second.outcome).toBe("success");
  });

  it("skips glob/template outputs without failing", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime();
    const result = await rt.runStage(request(ws, { outputs: ["chapters/*.md", "plan.md"] }));
    expect(result.outcome).toBe("success");
    expect(result.producedFiles).toEqual(["plan.md"]);
  });
});

describe("runtime registry", () => {
  it("has dry-run registered by default", () => {
    expect(getWorkerRuntime("dry-run").id).toBe("dry-run");
  });

  it("throws a helpful error for unknown runtimes", () => {
    expect(() => getWorkerRuntime("warp-drive")).toThrow(/warp-drive/);
  });

  it("allows registering custom runtimes", () => {
    registerWorkerRuntime({
      id: "custom-test",
      checkAvailable: async () => ({ available: true, supports_headless: true }),
      runStage: async () => ({ outcome: "success", producedFiles: [] }),
    });
    expect(getWorkerRuntime("custom-test").id).toBe("custom-test");
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement the three files**

`src/lib/workflow/runtimes/base.ts`:

```ts
import type { StageRunOutcome } from "../../schema.js";

export type RuntimeHealth = {
  available: boolean;
  supports_headless: boolean;
  max_concurrent?: number;
  requires_isolated_workspace?: boolean;
  detail?: string;
};

export type StageRunRequest = {
  workspaceDir: string;
  unitKey: string;
  owner: string;
  /** Rendered stage-contract prompt (also persisted to prompts/ by the engine). */
  instructions: string;
  /** Declared output paths; concrete paths are the contract the worker must satisfy. */
  outputs: string[];
  timeoutMs: number;
  model?: string;
  promptPath?: string;
  logPath?: string;
};

export type StageRunResult = {
  outcome: StageRunOutcome;
  /** Concrete files the runtime claims to have produced. */
  producedFiles: string[];
  message?: string;
  logRef?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
};

/** The execution boundary. The engine owns scheduling, retries, validation,
 *  and state; a runtime only knows how to run one unit of work headlessly. */
export interface WorkerRuntime {
  readonly id: string;
  checkAvailable(): Promise<RuntimeHealth>;
  runStage(req: StageRunRequest): Promise<StageRunResult>;
}
```

`src/lib/workflow/runtimes/registry.ts`:

```ts
import type { WorkerRuntime } from "./base.js";
import { DryRunRuntime } from "./dry-run.js";

// Deliberately separate from src/lib/adapters/registry.ts: those are
// install-time provisioners; these execute workflow units.
const runtimes = new Map<string, WorkerRuntime>();

export function registerWorkerRuntime(runtime: WorkerRuntime): void {
  runtimes.set(runtime.id, runtime);
}

export function getWorkerRuntime(id: string): WorkerRuntime {
  const runtime = runtimes.get(id);
  if (!runtime) {
    throw new Error(
      `Unknown worker runtime "${id}". Registered: ${[...runtimes.keys()].join(", ")}`,
    );
  }
  return runtime;
}

registerWorkerRuntime(new DryRunRuntime());
```

`src/lib/workflow/runtimes/dry-run.ts`:

```ts
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
        `# dry-run artifact\nunit: ${req.unitKey}\nowner: ${req.owner}\n`;
      await fs.writeFile(filePath, content, "utf-8");
      produced.push(output);
    }
    return { outcome: "success", producedFiles: produced };
  }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/dry-run-runtime.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow/runtimes tests/dry-run-runtime.test.ts
git commit -m "feat: add WorkerRuntime contract, registry, and DryRunRuntime"
```

---

### Task 4: Built-in Validators

**Files:**
- Test: `tests/flow-validators.test.ts`
- Create: `src/lib/workflow/validators.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/flow-validators.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runValidators } from "../src/lib/workflow/validators.js";

const tempDirs: string[] = [];
async function makeWorkspace(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-val-"));
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

describe("runValidators", () => {
  it("passes when required outputs exist", async () => {
    const ws = await makeWorkspace({ "plan.md": "# plan" });
    const report = await runValidators(["required_output_exists"], ["plan.md"], ws);
    expect(report.pass).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("fails with a named finding when an output is missing", async () => {
    const ws = await makeWorkspace();
    const report = await runValidators(["required_output_exists"], ["plan.md"], ws);
    expect(report.pass).toBe(false);
    expect(report.findings[0]).toContain("plan.md");
  });

  it("ignores glob/template outputs in existence checks (M2a)", async () => {
    const ws = await makeWorkspace();
    const report = await runValidators(["required_output_exists"], ["chapters/*.md"], ws);
    expect(report.pass).toBe(true);
  });

  it("fails empty markdown outputs", async () => {
    const ws = await makeWorkspace({ "plan.md": "   \n " });
    const report = await runValidators(["non_empty_markdown"], ["plan.md"], ws);
    expect(report.pass).toBe(false);
  });

  it("checks jsonl outputs line by line", async () => {
    const ws = await makeWorkspace({
      "good.jsonl": '{"a":1}\n{"b":2}\n',
      "bad.jsonl": '{"a":1}\nnot json\n',
    });
    const good = await runValidators(["jsonl_parseable"], ["good.jsonl"], ws);
    expect(good.pass).toBe(true);
    const bad = await runValidators(["jsonl_parseable"], ["bad.jsonl"], ws);
    expect(bad.pass).toBe(false);
    expect(bad.findings[0]).toContain("bad.jsonl");
  });

  it("fails closed on unknown validator names", async () => {
    const ws = await makeWorkspace({ "plan.md": "# plan" });
    const report = await runValidators(["definitely_not_real"], ["plan.md"], ws);
    expect(report.pass).toBe(false);
    expect(report.findings[0]).toContain("definitely_not_real");
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `src/lib/workflow/validators.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";

export type ValidatorReport = {
  pass: boolean;
  findings: string[];
};

type ValidatorFn = (outputs: string[], workspaceDir: string) => Promise<string[]>;

function concreteOutputs(outputs: string[]): string[] {
  return outputs.filter((o) => !o.includes("*") && !o.includes("{{"));
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

const builtins: Record<string, ValidatorFn> = {
  async required_output_exists(outputs, workspaceDir) {
    const findings: string[] = [];
    for (const output of concreteOutputs(outputs)) {
      if ((await readIfExists(path.join(workspaceDir, output))) === null) {
        findings.push(`required_output_exists: "${output}" was not produced`);
      }
    }
    return findings;
  },

  async non_empty_markdown(outputs, workspaceDir) {
    const findings: string[] = [];
    for (const output of concreteOutputs(outputs).filter((o) => o.endsWith(".md"))) {
      const content = await readIfExists(path.join(workspaceDir, output));
      if (content === null || content.trim().length === 0) {
        findings.push(`non_empty_markdown: "${output}" is missing or empty`);
      }
    }
    return findings;
  },

  async jsonl_parseable(outputs, workspaceDir) {
    const findings: string[] = [];
    for (const output of concreteOutputs(outputs).filter((o) => o.endsWith(".jsonl"))) {
      const content = await readIfExists(path.join(workspaceDir, output));
      if (content === null) {
        findings.push(`jsonl_parseable: "${output}" was not produced`);
        continue;
      }
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      for (let i = 0; i < lines.length; i++) {
        try {
          JSON.parse(lines[i]);
        } catch {
          findings.push(`jsonl_parseable: "${output}" line ${i + 1} is not valid JSON`);
          break;
        }
      }
    }
    return findings;
  },
};

/** Run named validators over a unit's declared outputs. Unknown validator
 *  names fail closed — a typo must not silently skip a quality gate. */
export async function runValidators(
  names: string[],
  outputs: string[],
  workspaceDir: string,
): Promise<ValidatorReport> {
  const findings: string[] = [];
  for (const name of names) {
    const fn = builtins[name];
    if (!fn) {
      findings.push(`unknown validator "${name}" (fail closed)`);
      continue;
    }
    findings.push(...(await fn(outputs, workspaceDir)));
  }
  return { pass: findings.length === 0, findings };
}
```

- [ ] **Step 4: Run tests** — PASS. **Step 5: Commit**

```bash
git add src/lib/workflow/validators.ts tests/flow-validators.test.ts
git commit -m "feat: add built-in flow validators (fail closed on unknown names)"
```

---

### Task 5: Prompt Contract Renderer

**Files:**
- Test: `tests/flow-prompt.test.ts`
- Create: `src/lib/workflow/prompt.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/flow-prompt.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure.** **Step 3: Implement `src/lib/workflow/prompt.ts`**

```ts
import type { StandardStage } from "../schema.js";

export type PromptContext = {
  stage: StandardStage;
  unitKey: string;
  retryFeedback?: string[];
};

function section(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `${title}:\n${items.map((i) => `- ${i}`).join("\n")}\n\n`;
}

/** Render the file-backed stage contract handed to a WorkerRuntime.
 *  The worker is a black box; this text IS the interface. */
export function renderUnitPrompt(ctx: PromptContext): string {
  const { stage, unitKey, retryFeedback } = ctx;
  let prompt = `Stage: ${unitKey}\n`;
  if (stage.title) prompt += `Title: ${stage.title}\n`;
  prompt += `Owner: ${stage.owner}\n\n`;
  prompt += section("Inputs", stage.inputs);
  prompt += section("Optional inputs (use if present, never required)", stage.optional_inputs);
  prompt += section("Required outputs", stage.outputs);
  prompt += section("Allowed tools", stage.tools);
  prompt += section("Validators that will check your outputs", stage.validators);
  prompt +=
    "Rules:\n" +
    "- Only write files listed under Required outputs (plus reports/).\n" +
    "- If blocked, write reports/" + unitKey + "-blocker.md explaining why.\n" +
    "- Do not ask for permissions interactively; fail fast instead.\n";
  if (retryFeedback && retryFeedback.length > 0) {
    prompt +=
      "\nPrevious attempt failed. Fix these findings:\n" +
      retryFeedback.map((f) => `- ${f}`).join("\n") +
      "\n";
  }
  return prompt;
}
```

- [ ] **Step 4: Run tests** — PASS. **Step 5: Commit**

```bash
git add src/lib/workflow/prompt.ts tests/flow-prompt.test.ts
git commit -m "feat: add stage-contract prompt renderer"
```

---

### Task 6: Engine Core

**Files:**
- Test: `tests/flow-engine.test.ts`
- Create: `src/lib/workflow/engine.ts`

Engine semantics (M2a):

- Stages run strictly in declared order; foreach stages throw a clear "M2b" error.
- Per unit: checkpoint existing concrete outputs → render + persist prompt → `runtime.runStage` → classify:
  - `success` → run validators → pass: `succeeded` (+ approval gate check); fail: retry with findings fed back, bounded by `retry.max_attempts` (default 2).
  - `validation_failed` / `worker_error` / `timeout` → same bounded retry (no findings).
  - `rate_limited` → backoff (configurable ms; tests use 0) and re-run WITHOUT consuming an attempt, at most 5 backoffs, unless `runtime_policy.on_rate_limit` is `"fail"`.
  - `quota_exhausted` / `permission_blocked` / `tool_missing` / `model_unavailable` / `budget_exceeded` → write `reports/<key>-blocker.md`, set `paused_blocker`, stop.
- `requires_human_approval` on a succeeded stage → queue approval, `paused_for_approval`, stop. `approveFlow` clears it; the next `runFlow` continues.
- Runtime/model resolution: `stage.runtime` → `model_tiers[stage.model_tier].runtime` → `runtime_policy.primary` → the `runtimeId` option → `"dry-run"`. Requested vs actual recorded in unit state.
- Workflow-hash mismatch on resume → error telling the user to rerun with `reset: true` (which re-inits state; artifacts untouched).

- [ ] **Step 1: Write the failing tests**

Create `tests/flow-engine.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowDef } from "../src/lib/schema.js";
import { runFlow, approveFlow, getFlowStatus } from "../src/lib/workflow/engine.js";
import { DryRunRuntime } from "../src/lib/workflow/runtimes/dry-run.js";
import { loadFlowState, readEvents } from "../src/lib/workflow/state.js";

const tempDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-eng-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

const simpleWf = WorkflowDef.parse({
  stages: [
    { id: "plan", owner: "pm", outputs: ["plan.md"], validators: ["required_output_exists"] },
    { id: "build", owner: "tech-lead", inputs: ["plan.md"], outputs: ["result.md"] },
  ],
});

describe("runFlow", () => {
  it("runs sequential stages to completion and writes artifacts + events", async () => {
    const ws = await makeWorkspace();
    const state = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("completed");
    expect(state.units.plan.status).toBe("succeeded");
    expect(state.units.build.status).toBe("succeeded");
    await fs.access(path.join(ws, "plan.md"));
    await fs.access(path.join(ws, "result.md"));
    const events = await readEvents(ws);
    expect(events.some((e) => e.type === "unit_succeeded" && e.key === "plan")).toBe(true);
    expect(events.some((e) => e.type === "flow_completed")).toBe(true);
  });

  it("persists prompts per attempt", async () => {
    const ws = await makeWorkspace();
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const prompt = await fs.readFile(
      path.join(ws, ".malaclaw/flow/prompts/plan-attempt1.md"), "utf-8");
    expect(prompt).toContain("Stage: plan");
  });

  it("retries with validator feedback and fails after max attempts", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{
        id: "plan", owner: "pm",
        outputs: ["never-written.md"],
        validators: ["required_output_exists"],
        retry: { max_attempts: 2 },
      }],
    });
    // Fixture-free dry-run writes the output... so point outputs at a template
    // the dry-run skips, forcing the validator to fail every attempt.
    const wf2 = WorkflowDef.parse({
      stages: [{
        id: "plan", owner: "pm",
        outputs: ["chapters/*.md"],
        validators: ["required_output_exists", "unknown_gate"],
        retry: { max_attempts: 2 },
      }],
    });
    const state = await runFlow({ workflow: wf2, workspaceDir: ws, runtime: new DryRunRuntime() });
    expect(state.status).toBe("failed");
    expect(state.units.plan.status).toBe("failed");
    expect(state.units.plan.attempts).toBe(2);
    // Second attempt's prompt carries the findings from the first.
    const prompt2 = await fs.readFile(
      path.join(ws, ".malaclaw/flow/prompts/plan-attempt2.md"), "utf-8");
    expect(prompt2).toContain("Previous attempt failed");
    expect(prompt2).toContain("unknown_gate");
    void wf;
  });

  it("pauses at an approval gate, then resumes after approveFlow", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [
        { id: "outline", owner: "pm", outputs: ["outline.md"], requires_human_approval: true },
        { id: "draft", owner: "pm", outputs: ["draft.md"] },
      ],
    });
    const runtime = new DryRunRuntime();
    const paused = await runFlow({ workflow: wf, workspaceDir: ws, runtime });
    expect(paused.status).toBe("paused_for_approval");
    expect(paused.pendingApprovals).toHaveLength(1);
    expect(paused.units.draft.status).toBe("pending");

    await approveFlow(ws, paused.pendingApprovals[0].id);
    const resumed = await runFlow({ workflow: wf, workspaceDir: ws, runtime });
    expect(resumed.status).toBe("completed");
    expect(resumed.units.draft.status).toBe("succeeded");
  });

  it("backs off and retries on rate_limited without consuming attempts", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({ outcomes: { plan: ["rate_limited", "rate_limited", "success"] } });
    const state = await runFlow({
      workflow: simpleWf, workspaceDir: ws, runtime, backoffMs: 0,
    });
    expect(state.status).toBe("completed");
    expect(state.units.plan.attempts).toBe(1);
  });

  it("pauses with a blocker report on quota_exhausted", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({ outcomes: { plan: ["quota_exhausted"] } });
    const state = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime });
    expect(state.status).toBe("paused_blocker");
    expect(state.units.plan.status).toBe("pending");
    const blocker = await fs.readFile(path.join(ws, "reports/plan-blocker.md"), "utf-8");
    expect(blocker).toContain("quota_exhausted");
  });

  it("resumes from saved state after interruption (blocker cleared)", async () => {
    const ws = await makeWorkspace();
    const first = new DryRunRuntime({ outcomes: { build: ["quota_exhausted"] } });
    const paused = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: first });
    expect(paused.status).toBe("paused_blocker");
    expect(paused.units.plan.status).toBe("succeeded");

    const second = new DryRunRuntime();
    const resumed = await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: second });
    expect(resumed.status).toBe("completed");
    // plan was NOT re-run on resume
    const events = await readEvents(ws);
    const planRuns = events.filter((e) => e.type === "unit_started" && e.key === "plan");
    expect(planRuns).toHaveLength(1);
  });

  it("checkpoints existing outputs before overwriting", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws, "plan.md"), "precious human draft", "utf-8");
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const checkpoints = await fs.readdir(path.join(ws, ".malaclaw/flow/checkpoints"));
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    const saved = await fs.readFile(
      path.join(ws, ".malaclaw/flow/checkpoints", checkpoints[0], "plan.md"), "utf-8");
    expect(saved).toBe("precious human draft");
  });

  it("rejects a stale state hash unless reset is passed", async () => {
    const ws = await makeWorkspace();
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const changed = WorkflowDef.parse({
      stages: [{ id: "plan", owner: "pm", outputs: ["plan.md"] }],
    });
    await expect(
      runFlow({ workflow: changed, workspaceDir: ws, runtime: new DryRunRuntime() }),
    ).rejects.toThrow(/changed|reset/i);
    const state = await runFlow({
      workflow: changed, workspaceDir: ws, runtime: new DryRunRuntime(), reset: true,
    });
    expect(state.status).toBe("completed");
  });

  it("throws a clear error for foreach stages (M2b)", async () => {
    const ws = await makeWorkspace();
    const wf = WorkflowDef.parse({
      stages: [{
        type: "foreach", id: "items", foreach: "outline.sections",
        steps: [{ id: "draft", owner: "pm" }],
      }],
    });
    await expect(
      runFlow({ workflow: wf, workspaceDir: ws, runtime: new DryRunRuntime() }),
    ).rejects.toThrow(/foreach/i);
  });
});

describe("getFlowStatus", () => {
  it("returns null before any run and state after", async () => {
    const ws = await makeWorkspace();
    expect(await getFlowStatus(ws)).toBeNull();
    await runFlow({ workflow: simpleWf, workspaceDir: ws, runtime: new DryRunRuntime() });
    const status = await getFlowStatus(ws);
    expect(status?.status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `src/lib/workflow/engine.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { StandardStage, WorkflowDef } from "../schema.js";
import {
  appendEvent,
  checkpointsDir,
  initFlowState,
  loadFlowState,
  promptsDir,
  saveFlowState,
  workflowHash,
  type FlowState,
} from "./state.js";
import { renderUnitPrompt } from "./prompt.js";
import { runValidators } from "./validators.js";
import type { StageRunResult, WorkerRuntime } from "./runtimes/base.js";

export type RunFlowOptions = {
  workflow: WorkflowDef;
  workspaceDir: string;
  runtime: WorkerRuntime;
  /** Re-initialize state when the workflow definition changed. */
  reset?: boolean;
  /** Backoff between rate-limited retries (tests use 0). */
  backoffMs?: number;
};

const MAX_BACKOFFS = 5;
const PAUSE_OUTCOMES = new Set([
  "quota_exhausted",
  "permission_blocked",
  "tool_missing",
  "model_unavailable",
  "budget_exceeded",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function concreteOutputs(outputs: string[]): string[] {
  return outputs.filter((o) => !o.includes("*") && !o.includes("{{"));
}

function resolveRuntimeId(stage: StandardStage, workflow: WorkflowDef, fallback: string): string {
  if (stage.runtime) return stage.runtime;
  if (stage.model_tier && workflow.model_tiers?.[stage.model_tier]) {
    return workflow.model_tiers[stage.model_tier].runtime;
  }
  return workflow.runtime_policy?.primary ?? fallback;
}

function resolveModel(stage: StandardStage, workflow: WorkflowDef): string | undefined {
  if (stage.model) return stage.model;
  if (stage.model_tier) return workflow.model_tiers?.[stage.model_tier]?.model;
  return undefined;
}

async function checkpointOutputs(workspaceDir: string, unitKey: string, outputs: string[]): Promise<void> {
  const existing: string[] = [];
  for (const output of concreteOutputs(outputs)) {
    try {
      await fs.access(path.join(workspaceDir, output));
      existing.push(output);
    } catch {
      // nothing to checkpoint
    }
  }
  if (existing.length === 0) return;
  const dir = path.join(
    checkpointsDir(workspaceDir),
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${unitKey}`,
  );
  for (const output of existing) {
    const dest = path.join(dir, output);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(workspaceDir, output), dest);
  }
}

async function writeBlocker(
  workspaceDir: string, unitKey: string, result: StageRunResult,
): Promise<void> {
  const reportPath = path.join(workspaceDir, "reports", `${unitKey}-blocker.md`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    `# Blocker: ${unitKey}\n\nOutcome: ${result.outcome}\n\n${result.message ?? ""}\n`,
    "utf-8",
  );
}

async function appendValidationReport(
  workspaceDir: string, unitKey: string, findings: string[], pass: boolean,
): Promise<void> {
  const reportPath = path.join(workspaceDir, "reports", "validation.md");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const body =
    `\n## ${new Date().toISOString()} — ${unitKey}: ${pass ? "PASS" : "FAIL"}\n` +
    (findings.length > 0 ? findings.map((f) => `- ${f}`).join("\n") + "\n" : "");
  await fs.appendFile(reportPath, body, "utf-8");
}

/** Run one unit to a terminal outcome: succeeded, failed, or paused. */
async function runUnit(
  stage: StandardStage,
  opts: RunFlowOptions,
  state: FlowState,
): Promise<"succeeded" | "failed" | "paused"> {
  const { workspaceDir, workflow, runtime } = opts;
  const unitKey = stage.id;
  const unit = state.units[unitKey];
  const maxAttempts = stage.retry?.max_attempts ?? 2;
  const requestedRuntimeId = resolveRuntimeId(stage, workflow, runtime.id);
  unit.requestedRuntime = requestedRuntimeId;
  // M2a: the caller supplies one runtime instance; record divergence rather
  // than silently swapping. Real multi-runtime dispatch arrives with M7.
  unit.actualRuntime = runtime.id;

  await checkpointOutputs(workspaceDir, unitKey, stage.outputs);

  let retryFeedback: string[] | undefined;
  let backoffs = 0;

  while (unit.attempts < maxAttempts) {
    unit.attempts += 1;
    unit.status = "running";
    await appendEvent(workspaceDir, {
      type: "unit_started", key: unitKey, attempt: unit.attempts,
      requestedRuntime: requestedRuntimeId, actualRuntime: runtime.id,
    });

    const prompt = renderUnitPrompt({ stage, unitKey, retryFeedback });
    await fs.mkdir(promptsDir(workspaceDir), { recursive: true });
    const promptPath = path.join(promptsDir(workspaceDir), `${unitKey}-attempt${unit.attempts}.md`);
    await fs.writeFile(promptPath, prompt, "utf-8");

    let result = await runtime.runStage({
      workspaceDir, unitKey, owner: stage.owner, instructions: prompt,
      outputs: stage.outputs, timeoutMs: 600_000,
      model: resolveModel(stage, workflow), promptPath,
    });

    // Rate limits back off and re-run without consuming an attempt.
    while (result.outcome === "rate_limited") {
      unit.lastOutcome = result.outcome;
      if (workflow.runtime_policy?.on_rate_limit === "fail" || backoffs >= MAX_BACKOFFS) {
        unit.status = "failed";
        unit.lastError = "rate limited too many times";
        await appendEvent(workspaceDir, { type: "unit_failed", key: unitKey, outcome: result.outcome });
        return "failed";
      }
      backoffs += 1;
      await appendEvent(workspaceDir, { type: "unit_backoff", key: unitKey, backoffs });
      await sleep(opts.backoffMs ?? 1000);
      result = await runtime.runStage({
        workspaceDir, unitKey, owner: stage.owner, instructions: prompt,
        outputs: stage.outputs, timeoutMs: 600_000,
        model: resolveModel(stage, workflow), promptPath,
      });
    }

    unit.lastOutcome = result.outcome;

    if (PAUSE_OUTCOMES.has(result.outcome)) {
      unit.status = "pending"; // re-runnable once the blocker clears
      unit.attempts -= 1; // the blocked attempt does not count
      await writeBlocker(workspaceDir, unitKey, result);
      await appendEvent(workspaceDir, { type: "flow_paused_blocker", key: unitKey, outcome: result.outcome });
      return "paused";
    }

    if (result.outcome === "success") {
      const report = await runValidators(stage.validators, stage.outputs, workspaceDir);
      await appendValidationReport(workspaceDir, unitKey, report.findings, report.pass);
      if (report.pass) {
        unit.status = "succeeded";
        await appendEvent(workspaceDir, { type: "unit_succeeded", key: unitKey, usage: result.usage });
        return "succeeded";
      }
      retryFeedback = report.findings;
      unit.lastError = report.findings.join("; ");
      await appendEvent(workspaceDir, {
        type: "unit_validation_failed", key: unitKey, findings: report.findings,
      });
      continue;
    }

    // worker_error / timeout / validation_failed from the runtime itself
    unit.lastError = result.message ?? result.outcome;
    retryFeedback = [result.message ?? `worker reported ${result.outcome}`];
    await appendEvent(workspaceDir, { type: "unit_attempt_failed", key: unitKey, outcome: result.outcome });
  }

  unit.status = "failed";
  await appendEvent(workspaceDir, { type: "unit_failed", key: unitKey });
  return "failed";
}

export async function runFlow(opts: RunFlowOptions): Promise<FlowState> {
  const { workflow, workspaceDir } = opts;

  for (const stage of workflow.stages) {
    if ("steps" in stage) {
      throw new Error(
        `Stage "${stage.id}" is a foreach stage — foreach scheduling arrives in the next milestone (M2b)`,
      );
    }
  }

  let state = await loadFlowState(workspaceDir);
  if (state && state.workflowHash !== workflowHash(workflow)) {
    if (!opts.reset) {
      throw new Error(
        "The workflow definition changed since this flow started. " +
        "Re-run with reset to start fresh (artifacts are kept; state is reinitialized).",
      );
    }
    state = null;
  }
  if (!state) {
    state = await initFlowState(workflow, workspaceDir);
    await appendEvent(workspaceDir, { type: "flow_initialized" });
  }
  if (state.status === "completed") return state;

  state.status = "running";
  await saveFlowState(workspaceDir, state);

  for (const stage of workflow.stages) {
    const unit = state.units[stage.id];
    if (unit.status === "succeeded") continue;

    if (state.pendingApprovals.length > 0) {
      state.status = "paused_for_approval";
      await saveFlowState(workspaceDir, state);
      return state;
    }

    // Reset attempts for units re-entering after a blocker pause.
    unit.status = "pending";
    const outcome = await runUnit(stage as StandardStage, opts, state);
    await saveFlowState(workspaceDir, state);

    if (outcome === "failed") {
      state.status = "failed";
      await appendEvent(workspaceDir, { type: "flow_failed", key: stage.id });
      await saveFlowState(workspaceDir, state);
      return state;
    }
    if (outcome === "paused") {
      state.status = "paused_blocker";
      await saveFlowState(workspaceDir, state);
      return state;
    }

    if ((stage as StandardStage).requires_human_approval) {
      state.pendingApprovals.push({
        id: `approve-${stage.id}-${String(state.pendingApprovals.length + 1).padStart(3, "0")}`,
        stageId: stage.id,
        artifacts: concreteOutputs((stage as StandardStage).outputs),
      });
      state.status = "paused_for_approval";
      await appendEvent(workspaceDir, { type: "flow_paused_approval", key: stage.id });
      await saveFlowState(workspaceDir, state);
      return state;
    }
  }

  state.status = "completed";
  await appendEvent(workspaceDir, { type: "flow_completed" });
  await saveFlowState(workspaceDir, state);
  return state;
}

export async function approveFlow(workspaceDir: string, approvalId: string): Promise<FlowState> {
  const state = await loadFlowState(workspaceDir);
  if (!state) throw new Error("No flow state found. Run `malaclaw flow run` first.");
  const index = state.pendingApprovals.findIndex((a) => a.id === approvalId);
  if (index === -1) {
    throw new Error(
      `Approval "${approvalId}" not found. Pending: ${state.pendingApprovals.map((a) => a.id).join(", ") || "none"}`,
    );
  }
  state.pendingApprovals.splice(index, 1);
  if (state.pendingApprovals.length === 0 && state.status === "paused_for_approval") {
    state.status = "idle";
  }
  await appendEvent(workspaceDir, { type: "approval_granted", key: approvalId });
  await saveFlowState(workspaceDir, state);
  return state;
}

export async function getFlowStatus(workspaceDir: string): Promise<FlowState | null> {
  return loadFlowState(workspaceDir);
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/flow-engine.test.ts` → PASS. Then `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow/engine.ts tests/flow-engine.test.ts
git commit -m "feat: add deterministic flow engine core (sequential stages, retries, gates, blockers)"
```

---

### Task 7: `malaclaw flow` CLI

**Files:**
- Create: `src/commands/flow.ts`
- Modify: `src/cli.ts`

No new unit tests: the command layer is thin over tested lib functions; verification is the build + smoke test below (matching how existing commands like `validate` are covered).

- [ ] **Step 1: Implement `src/commands/flow.ts`**

```ts
import { loadManifest } from "../lib/loader.js";
import { resolveManifest } from "../lib/resolver.js";
import { runFlow, approveFlow, getFlowStatus } from "../lib/workflow/engine.js";
import { getWorkerRuntime } from "../lib/workflow/runtimes/registry.js";

export async function runFlowRun(opts: { runtime?: string; reset?: boolean }): Promise<void> {
  const workspaceDir = process.cwd();
  const manifest = await loadManifest(workspaceDir);
  const resolved = await resolveManifest(manifest, { projectDir: workspaceDir });
  if (!resolved.workflow) {
    console.log("No workflow: section in malaclaw.yaml — nothing to run.");
    process.exit(1);
  }
  for (const w of resolved.workflowWarnings) console.log(`⚠ ${w}`);

  const runtime = getWorkerRuntime(opts.runtime ?? resolved.workflow.runtime_policy?.primary ?? "dry-run");
  const health = await runtime.checkAvailable();
  if (!health.available) {
    console.log(`✗ Runtime "${runtime.id}" is not available${health.detail ? `: ${health.detail}` : ""}`);
    process.exit(1);
  }

  const state = await runFlow({ workflow: resolved.workflow, workspaceDir, runtime, reset: opts.reset });
  printState(state);
  if (state.status === "failed") process.exit(1);
}

export async function runFlowStatus(): Promise<void> {
  const state = await getFlowStatus(process.cwd());
  if (!state) {
    console.log("No flow state. Run: malaclaw flow run");
    return;
  }
  printState(state);
}

export async function runFlowApprove(approvalId: string): Promise<void> {
  const state = await approveFlow(process.cwd(), approvalId);
  console.log(`✓ Approved ${approvalId}`);
  printState(state);
}

export async function runFlowReport(): Promise<void> {
  const state = await getFlowStatus(process.cwd());
  if (!state || state.pendingApprovals.length === 0) {
    console.log("No pending approvals.");
    return;
  }
  console.log("# Pending review\n");
  for (const approval of state.pendingApprovals) {
    console.log(`- ${approval.id} (stage: ${approval.stageId})`);
    for (const artifact of approval.artifacts) console.log(`    artifact: ${artifact}`);
    console.log(`    approve with: malaclaw flow approve ${approval.id}`);
  }
}

function printState(state: {
  status: string;
  units: Record<string, { status: string; attempts: number }>;
  pendingApprovals: Array<{ id: string; stageId: string }>;
}): void {
  console.log(`\nFlow status: ${state.status}`);
  for (const [key, unit] of Object.entries(state.units)) {
    const mark = unit.status === "succeeded" ? "✓" : unit.status === "failed" ? "✗" : "·";
    console.log(`  ${mark} ${key} (${unit.status}, attempts: ${unit.attempts})`);
  }
  for (const approval of state.pendingApprovals) {
    console.log(`  ⏸ approval required: ${approval.id} — malaclaw flow approve ${approval.id}`);
  }
}
```

- [ ] **Step 2: Register in `src/cli.ts`** (after the validate block):

```ts
// ── flow ──────────────────────────────────────────────────────────────────────

const flow = program
  .command("flow")
  .description("Run and manage workflow flows (workflow: section in malaclaw.yaml)");

flow
  .command("run")
  .description("Run the workflow from current state (resumes automatically)")
  .option("--runtime <id>", "Worker runtime to use (default: workflow runtime_policy or dry-run)")
  .option("--reset", "Reinitialize state after a workflow definition change")
  .action(async (opts) => {
    const { runFlowRun } = await import("./commands/flow.js");
    await runFlowRun({ runtime: opts.runtime, reset: opts.reset });
  });

flow
  .command("status")
  .description("Show current flow state")
  .action(async () => {
    const { runFlowStatus } = await import("./commands/flow.js");
    await runFlowStatus();
  });

flow
  .command("approve <approvalId>")
  .description("Grant a pending approval, unblocking dependent stages")
  .action(async (approvalId) => {
    const { runFlowApprove } = await import("./commands/flow.js");
    await runFlowApprove(approvalId);
  });

flow
  .command("report")
  .description("List pending approvals for batch review")
  .action(async () => {
    const { runFlowReport } = await import("./commands/flow.js");
    await runFlowReport();
  });
```

- [ ] **Step 3: Build and smoke-test end to end**

```bash
npm run build
cd "$(mktemp -d)"
cat > malaclaw.yaml <<'EOF'
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
      owner: pm
      outputs:
        - plan.md
      validators:
        - required_output_exists
    - id: outline
      owner: pm
      outputs:
        - outline.md
      requires_human_approval: true
    - id: build
      owner: tech-lead
      inputs:
        - outline.md
      outputs:
        - result.md
EOF
node <path-to>/dist/cli.js flow run          # expect: paused_for_approval after outline
node <path-to>/dist/cli.js flow report       # expect: approve-outline-001 listed
node <path-to>/dist/cli.js flow approve approve-outline-001
node <path-to>/dist/cli.js flow run          # expect: completed, result.md exists
node <path-to>/dist/cli.js flow status       # expect: completed
```

- [ ] **Step 4: Run the full suite** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/flow.ts src/cli.ts
git commit -m "feat: add malaclaw flow run/status/approve/report commands"
```

---

### Task 8: Docs

- [ ] **Step 1:** In `CLAUDE.md` directory-structure notes, add under `src/lib/`: `workflow/` — flow engine: state, engine, prompt, validators, runtimes (WorkerRuntime registry + dry-run). In the Useful Commands section of `README.md`, add:

```bash
# workflow flows
malaclaw flow run
malaclaw flow status
malaclaw flow approve <id>
malaclaw flow report
```

- [ ] **Step 2: Final verification** — `npm run build && npm test && node dist/cli.js validate` all clean.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document flow engine commands"
```

---

## Out of Scope (M2b and later)

- Foreach item expansion, pipelined step scheduling, bounded parallel pool (M2b — the engine throws a clear error today).
- Review queue with batch approve/reject and scheduled digests beyond `flow report` (M2b/M6).
- Budget *enforcement* and cost tracking (schema only for now; behavior with real runtimes, M7).
- Runtime fallback *dispatch* (`on_quota_exhausted: try_fallback` is schema; engine currently pauses — dispatch needs multiple registered runtimes, M7).
- claude-code / codex / API / local WorkerRuntimes (M7).
- Rendering workflow guidance into agent workspace files.
