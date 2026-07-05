# MalaClaw Flow Engine Foreach + Review Queue (Milestone 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Foreach stages execute for real: items expand from a machine-readable artifact, each item runs its ordered steps as a pipeline, different items run in parallel under a bounded pool, and step-level approvals accumulate in a review queue that blocks only that item's later steps (plus any later stage) — reviewable in batch. This completes the spec's Milestone 2.

**Architecture:** The engine's `runUnit` is refactored onto a runtime-neutral `WorkUnitSpec` so standard stages and foreach item-steps share one execution path. A new `foreach.ts` owns item expansion (`foreach: outline.sections` → `outline.json` key `sections`) and `{{item.id}}` template resolution — templates are resolved *before* a runtime sees them, so runtimes only ever get concrete paths. Item expansion is persisted in state (`foreachItems`) so resume never re-reads a changed artifact mid-flight. Scheduling is a promise pool: fill slots with ready item-steps (readiness = previous step of the same item succeeded and not blocked by a pending review), `Promise.race`, repeat.

**Tech Stack:** unchanged (TypeScript, Zod v3, Vitest 4). Branch `workflow-schema`.

**Spec:** design spec §3 (Foreach item pipelines, Approval gates vs review cadence), Milestone 2.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/lib/workflow/state.ts` | Modify | `FlowState.foreachItems` (persisted expansion); `PendingApproval` gains `stepId`/`itemId` |
| `src/lib/workflow/foreach.ts` | Create | `resolveItemTemplates()`, `expandForeachItems()` (artifact reader) |
| `src/lib/workflow/engine.ts` | Modify | `WorkUnitSpec` refactor; foreach scheduler with bounded pool; step-approval queue; `approveAllFlow()`; completion honors pending approvals |
| `src/lib/workflow/prompt.ts` | Modify | Accept a structural work-unit shape (steps, not just `StandardStage`) |
| `src/lib/workflow/runtimes/dry-run.ts` | Modify | Default deterministic JSON fixture for `*.json` outputs so CLI dry runs can drive foreach |
| `src/commands/flow.ts` + `src/cli.ts` | Modify | `flow review --batch`, `flow continue` |
| `tests/flow-foreach.test.ts` | Create | Expansion, templates, pipeline scheduling, parallel cap, failure isolation, step reviews, resume |
| `CLAUDE.md` / `README.md` | Modify | Command list update |

Semantics locked in this plan:

1. `foreach: "<base>.<key>"` reads `<base>.json` at the workspace root; `<key>` must be an array of objects with a string `id`. Missing artifact/key/ids → the stage fails with a pointed error (the outline stage must emit `outline.json`).
2. Unit key format: `<stageId>.<stepId>[<itemId>]`.
3. Readiness: an item's step is ready when the previous step for that item succeeded AND no pending approval exists for an earlier step of that item. Different items are independent.
4. Concurrency cap: `min(stage.max_parallel, workflow.max_parallel, runtime.max_concurrent ?? ∞)`.
5. A failed item stops only that item; other items finish; the stage then fails the flow.
6. A blocker outcome pauses the whole flow after in-flight units settle.
7. Step `requires_human_approval: true` → on success, a review item `{id, stageId, stepId, itemId, artifacts}` joins the queue. It blocks that item's later steps and any later stage, not sibling items. `flow approve <id>` clears one; `flow review --batch` clears all; a flow with nothing left to run but pending reviews is `paused_for_approval`, and a flow never reports `completed` while reviews are pending.

---

### Task 1: State + DryRun groundwork

**Files:** Modify `src/lib/workflow/state.ts`, `src/lib/workflow/runtimes/dry-run.ts`; extend `tests/flow-state.test.ts`, `tests/dry-run-runtime.test.ts`.

- [ ] **Step 1: Failing tests.** Append to `tests/flow-state.test.ts`:

```ts
  it("persists foreach item expansions", async () => {
    const ws = await makeWorkspace();
    const state = await initFlowState(wf, ws);
    state.foreachItems["draft_sections"] = ["s1", "s2"];
    await saveFlowState(ws, state);
    const loaded = await loadFlowState(ws);
    expect(loaded?.foreachItems["draft_sections"]).toEqual(["s1", "s2"]);
  });
```

Append to `tests/dry-run-runtime.test.ts` (inside the DryRunRuntime describe):

```ts
  it("writes a deterministic items fixture for .json outputs", async () => {
    const ws = await makeWorkspace();
    const rt = new DryRunRuntime();
    await rt.runStage(request(ws, { outputs: ["outline.json"] }));
    const parsed = JSON.parse(await fs.readFile(path.join(ws, "outline.json"), "utf-8"));
    expect(parsed.sections.length).toBeGreaterThanOrEqual(2);
    expect(parsed.sections[0].id).toBeTruthy();
    expect(parsed.chapters[0].id).toBeTruthy();
  });
```

- [ ] **Step 2: Implement.** In `state.ts`: add to `FlowState` (after `pendingApprovals`): `foreachItems: z.record(z.array(z.string())).default({}),`. Add to `PendingApproval`: `stepId: z.string().optional(), itemId: z.string().optional(),`. In `dry-run.ts`, in `runStage`'s content selection, before the generic placeholder: if `output.endsWith(".json")` and no fixture, write

```ts
        JSON.stringify({
          sections: [{ id: "section-1" }, { id: "section-2" }],
          chapters: [{ id: "chapter-1" }, { id: "chapter-2" }],
          items: [{ id: "item-1" }, { id: "item-2" }],
        })
```

- [ ] **Step 3:** Targeted tests + `npm test` pass. Commit: `feat: persist foreach expansion in flow state; dry-run json items fixture`.

---

### Task 2: Foreach expansion + template resolution

**Files:** Create `src/lib/workflow/foreach.ts`; Test `tests/flow-foreach.test.ts` (first describe blocks).

- [ ] **Step 1: Failing tests.** Create `tests/flow-foreach.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ForeachStage } from "../src/lib/schema.js";
import { resolveItemTemplates, expandForeachItems } from "../src/lib/workflow/foreach.js";

const tempDirs: string[] = [];
async function makeWorkspace(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-fe-"));
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

describe("resolveItemTemplates", () => {
  it("substitutes the declared item_name and the generic item", () => {
    expect(resolveItemTemplates("chapters/{{section.id}}.md", "section", "s1"))
      .toBe("chapters/s1.md");
    expect(resolveItemTemplates("chapters/{{item.id}}.md", "section", "s1"))
      .toBe("chapters/s1.md");
  });

  it("leaves unrelated templates untouched", () => {
    expect(resolveItemTemplates("x/{{other.id}}.md", "section", "s1"))
      .toBe("x/{{other.id}}.md");
  });
});

describe("expandForeachItems", () => {
  const stage = ForeachStage.parse({
    type: "foreach", id: "draft_sections", foreach: "outline.sections",
    steps: [{ id: "draft", owner: "pm" }],
  });

  it("reads item ids from the artifact key", async () => {
    const ws = await makeWorkspace({
      "outline.json": JSON.stringify({ sections: [{ id: "s1" }, { id: "s2" }] }),
    });
    expect(await expandForeachItems(stage, ws)).toEqual(["s1", "s2"]);
  });

  it("throws a pointed error when the artifact is missing", async () => {
    const ws = await makeWorkspace();
    await expect(expandForeachItems(stage, ws)).rejects.toThrow(/outline\.json/);
  });

  it("throws when the key is missing or malformed", async () => {
    const ws = await makeWorkspace({ "outline.json": JSON.stringify({ sections: [{ name: "no-id" }] }) });
    await expect(expandForeachItems(stage, ws)).rejects.toThrow(/id/);
    const ws2 = await makeWorkspace({ "outline.json": JSON.stringify({ other: [] }) });
    await expect(expandForeachItems(ForeachStage.parse({
      type: "foreach", id: "x", foreach: "outline.sections",
      steps: [{ id: "draft", owner: "pm" }],
    }), ws2)).rejects.toThrow(/sections/);
  });
});
```

- [ ] **Step 2: Implement `src/lib/workflow/foreach.ts`**:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { ForeachStage } from "../schema.js";

/** Replace {{<item_name>.id}} and {{item.id}} with the concrete item id.
 *  Other templates are left for future variables. */
export function resolveItemTemplates(text: string, itemName: string, itemId: string): string {
  return text
    .replaceAll(`{{${itemName}.id}}`, itemId)
    .replaceAll("{{item.id}}", itemId);
}

/** `foreach: "<base>.<key>"` reads `<base>.json` at the workspace root and
 *  returns the ids under <key>. The producing stage must emit that artifact
 *  (e.g. outline.json next to outline.md). */
export async function expandForeachItems(stage: ForeachStage, workspaceDir: string): Promise<string[]> {
  const dot = stage.foreach.indexOf(".");
  const base = dot === -1 ? stage.foreach : stage.foreach.slice(0, dot);
  const key = dot === -1 ? "items" : stage.foreach.slice(dot + 1);
  const artifact = `${base}.json`;

  let raw: string;
  try {
    raw = await fs.readFile(path.join(workspaceDir, artifact), "utf-8");
  } catch {
    throw new Error(
      `Foreach stage "${stage.id}": artifact "${artifact}" not found — an earlier stage must produce it with a "${key}" array`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Foreach stage "${stage.id}": "${artifact}" is not valid JSON`);
  }
  const list = (parsed as Record<string, unknown>)[key];
  if (!Array.isArray(list)) {
    throw new Error(`Foreach stage "${stage.id}": "${artifact}" has no "${key}" array`);
  }
  const ids: string[] = [];
  for (const entry of list) {
    const id = (entry as Record<string, unknown>)?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Foreach stage "${stage.id}": every "${key}" entry needs a string id`);
    }
    ids.push(id);
  }
  return ids;
}
```

- [ ] **Step 3:** Tests pass. Commit: `feat: add foreach item expansion and template resolution`.

---

### Task 3: Engine — WorkUnitSpec refactor + foreach scheduler + review queue

**Files:** Modify `src/lib/workflow/engine.ts`, `src/lib/workflow/prompt.ts`; extend `tests/flow-foreach.test.ts`.

**Refactor:** introduce

```ts
export type WorkUnitSpec = {
  key: string;
  title?: string;
  owner: string;
  inputs: string[];
  optional_inputs: string[];
  outputs: string[];
  tools: string[];
  validators: string[];
  retry?: { max_attempts: number };
  runtime?: string;
  model?: string;
  model_tier?: string;
};
```

`runUnit(spec: WorkUnitSpec, ...)` reads only spec fields (unit key = `spec.key`). `prompt.ts` changes `PromptContext.stage` to a structural type with exactly the fields the renderer uses (`title?/owner/inputs/optional_inputs/outputs/tools/validators`) — existing tests still pass since `StandardStage` satisfies it. Standard stages map to one spec (`stageToSpec`); foreach item-steps map via `stepToSpec(stage, step, itemId)` with `resolveItemTemplates` applied to every inputs/optional_inputs/outputs entry, key `${stage.id}.${step.id}[${itemId}]`.

**Scheduler (`runForeachStage`)** — semantics from the header block:

```ts
async function runForeachStage(
  stage: ForeachStage, opts: RunFlowOptions, state: FlowState, maxConcurrent: number,
): Promise<"succeeded" | "failed" | "paused" | "awaiting_review"> {
  // 1. ensure expansion (state.foreachItems[stage.id] or expandForeachItems + create pending units)
  // 2. cap = min(stage.max_parallel, workflow.max_parallel, maxConcurrent)
  // 3. pool loop:
  //    while (true):
  //      if not pausing: for each ready spec (readiness rule) while running.size < cap → start runUnit
  //      if running empty → break
  //      settle one via Promise.race; save state
  //      on "paused" → pausing = true (stop launching; let in-flight settle)
  //      on succeeded step with requires_human_approval → queue review {stageId, stepId, itemId}
  // 4. return: paused if pausing; failed if any unit failed; awaiting_review if
  //    stage finished all runnable work but reviews for this stage are pending;
  //    else succeeded
}
```

Readiness for item `i`: first step index `k` whose unit is `pending`; blocked if any earlier step's unit failed, or a pending approval exists with `stageId === stage.id && itemId === i`. Note the whole-item block on any pending review for that item implements "block only dependents."

`runFlow` changes:
- foreach pre-check throw REMOVED; `initFlowState` no longer pre-creates units for foreach stages (they're created at expansion) — change its loop to `if (!("steps" in stage)) units[stage.id] = UnitState.parse({});`.
- stage loop: `if ("steps" in stage)` → `runForeachStage` (stage completeness = all its units succeeded and no pending reviews for it); else existing standard path via `stageToSpec`.
- Stage-level skip check for foreach: completed when expansion exists and every `${stage.id}.` unit succeeded and no approvals for the stage remain.
- `maxConcurrent` from `await opts.runtime.checkAvailable()` once at flow start.
- Final status: `pendingApprovals.length > 0 ? "paused_for_approval" : "completed"`.
- `approveAllFlow(workspaceDir)` exported: clears every pending approval (events per approval), sets status `idle` if it was `paused_for_approval`.
- `awaiting_review` from a foreach stage → status `paused_for_approval`, return (same as approval pause).

- [ ] **Step 1: Failing tests.** Append to `tests/flow-foreach.test.ts` (imports extended with `WorkflowDef`, `runFlow`, `approveFlow`, `approveAllFlow`, `getFlowStatus` from engine, `DryRunRuntime`, `readEvents`):

```ts
const outlineFixture = JSON.stringify({ sections: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] });

const foreachWf = WorkflowDef.parse({
  stages: [
    { id: "outline", owner: "pm", outputs: ["outline.md", "outline.json"] },
    {
      type: "foreach", id: "sections", foreach: "outline.sections",
      item_name: "section", max_parallel: 2,
      steps: [
        { id: "draft", owner: "pm", outputs: ["chapters/{{section.id}}.md"] },
        {
          id: "review", owner: "pm",
          inputs: ["chapters/{{section.id}}.md"],
          outputs: ["reviews/{{section.id}}.md"],
          validators: ["required_output_exists"],
        },
      ],
    },
    { id: "assemble", owner: "pm", outputs: ["book.md"] },
  ],
});

describe("foreach execution", () => {
  it("runs every item pipeline to completion with resolved paths", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({ fixtures: { "outline.json": outlineFixture } });
    const state = await runFlow({ workflow: foreachWf, workspaceDir: ws, runtime });
    expect(state.status).toBe("completed");
    for (const id of ["s1", "s2", "s3"]) {
      await fs.access(path.join(ws, `chapters/${id}.md`));
      await fs.access(path.join(ws, `reviews/${id}.md`));
      expect(state.units[`sections.draft[${id}]`].status).toBe("succeeded");
      expect(state.units[`sections.review[${id}]`].status).toBe("succeeded");
    }
    await fs.access(path.join(ws, "book.md"));
    expect(state.foreachItems.sections).toEqual(["s1", "s2", "s3"]);
  });

  it("respects the parallel cap and pipelines steps across items", async () => {
    const ws = await makeWorkspace();
    let inFlight = 0;
    let peak = 0;
    const inner = new DryRunRuntime({ fixtures: { "outline.json": outlineFixture } });
    const probe = {
      id: "dry-run",
      checkAvailable: () => inner.checkAvailable(),
      async runStage(req: Parameters<typeof inner.runStage>[0]) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        const result = await inner.runStage(req);
        inFlight -= 1;
        return result;
      },
    };
    const state = await runFlow({ workflow: foreachWf, workspaceDir: ws, runtime: probe });
    expect(state.status).toBe("completed");
    expect(peak).toBeLessThanOrEqual(2); // stage max_parallel
    expect(peak).toBeGreaterThan(1);     // actually parallel
  });

  it("isolates a failed item; siblings finish; flow fails", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({
      fixtures: { "outline.json": outlineFixture },
      outcomes: { "sections.draft[s2]": ["worker_error", "worker_error"] },
    });
    const state = await runFlow({ workflow: foreachWf, workspaceDir: ws, runtime });
    expect(state.status).toBe("failed");
    expect(state.units["sections.draft[s2]"].status).toBe("failed");
    expect(state.units["sections.review[s2]"].status).toBe("pending"); // never ran
    expect(state.units["sections.review[s1]"].status).toBe("succeeded");
    expect(state.units.assemble.status).toBe("pending"); // later stage blocked
  });

  it("pauses the whole flow on a blocker and resumes cleanly", async () => {
    const ws = await makeWorkspace();
    const first = new DryRunRuntime({
      fixtures: { "outline.json": outlineFixture },
      outcomes: { "sections.draft[s2]": ["quota_exhausted"] },
    });
    const paused = await runFlow({ workflow: foreachWf, workspaceDir: ws, runtime: first });
    expect(paused.status).toBe("paused_blocker");

    const resumed = await runFlow({
      workflow: foreachWf, workspaceDir: ws,
      runtime: new DryRunRuntime({ fixtures: { "outline.json": outlineFixture } }),
    });
    expect(resumed.status).toBe("completed");
    // expansion was reused, not re-read
    const events = await readEvents(ws);
    expect(events.filter((e) => e.type === "foreach_expanded")).toHaveLength(1);
  });
});

describe("step-level review queue", () => {
  const reviewWf = WorkflowDef.parse({
    stages: [
      { id: "outline", owner: "pm", outputs: ["outline.json"] },
      {
        type: "foreach", id: "sections", foreach: "outline.sections",
        item_name: "section", max_parallel: 3,
        steps: [
          {
            id: "draft", owner: "pm",
            outputs: ["chapters/{{section.id}}.md"],
            requires_human_approval: true,
          },
          {
            id: "polish", owner: "pm",
            inputs: ["chapters/{{section.id}}.md"],
            outputs: ["polished/{{section.id}}.md"],
          },
        ],
      },
    ],
  });

  it("queues reviews without blocking sibling items, blocks dependents", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({ fixtures: { "outline.json": outlineFixture } });
    const state = await runFlow({ workflow: reviewWf, workspaceDir: ws, runtime });
    expect(state.status).toBe("paused_for_approval");
    expect(state.pendingApprovals).toHaveLength(3); // one per item
    for (const id of ["s1", "s2", "s3"]) {
      expect(state.units[`sections.draft[${id}]`].status).toBe("succeeded");
      expect(state.units[`sections.polish[${id}]`].status).toBe("pending");
    }
  });

  it("approving one item unblocks only that item's pipeline", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({ fixtures: { "outline.json": outlineFixture } });
    const paused = await runFlow({ workflow: reviewWf, workspaceDir: ws, runtime });
    const s1Approval = paused.pendingApprovals.find((a) => a.itemId === "s1")!;
    await approveFlow(ws, s1Approval.id);
    const after = await runFlow({ workflow: reviewWf, workspaceDir: ws, runtime });
    expect(after.units["sections.polish[s1]"].status).toBe("succeeded");
    expect(after.units["sections.polish[s2]"].status).toBe("pending");
    expect(after.status).toBe("paused_for_approval");
  });

  it("approveAllFlow clears the queue and the flow completes", async () => {
    const ws = await makeWorkspace();
    const runtime = new DryRunRuntime({ fixtures: { "outline.json": outlineFixture } });
    await runFlow({ workflow: reviewWf, workspaceDir: ws, runtime });
    await approveAllFlow(ws);
    const done = await runFlow({ workflow: reviewWf, workspaceDir: ws, runtime });
    expect(done.status).toBe("completed");
    expect(done.pendingApprovals).toEqual([]);
  });
});
```

- [ ] **Step 2:** Implement the refactor + scheduler per the design block above. Key correctness points:
  - Save state after each settled unit (crash-safe mid-foreach).
  - `foreach_expanded` event emitted exactly once per stage (on expansion).
  - Standard-stage behavior unchanged — all M2a engine tests must stay green.
- [ ] **Step 3:** `npx vitest run tests/flow-foreach.test.ts tests/flow-engine.test.ts` → PASS; `npm test` → PASS.
- [ ] **Step 4:** Commit: `feat: foreach item pipelines with bounded parallel scheduler and review queue`.

---

### Task 4: CLI — `flow review --batch`, `flow continue`

**Files:** Modify `src/commands/flow.ts`, `src/cli.ts`.

- [ ] **Step 1:** Add to `flow.ts`:

```ts
export async function runFlowReviewBatch(): Promise<void> {
  const { approveAllFlow } = await import("../lib/workflow/engine.js");
  const state = await approveAllFlow(process.cwd());
  console.log("✓ Approved all pending review items");
  printState(state);
  console.log("\nContinue with: malaclaw flow run");
}
```

(`runFlowRun` doubles as `continue`.) Register in `cli.ts` under the flow group:

```ts
flow
  .command("review")
  .description("Batch-review pending approvals")
  .option("--batch", "Approve all pending review items")
  .action(async (opts) => {
    if (!opts.batch) {
      const { runFlowReport } = await import("./commands/flow.js");
      await runFlowReport();
      return;
    }
    const { runFlowReviewBatch } = await import("./commands/flow.js");
    await runFlowReviewBatch();
  });

flow
  .command("continue")
  .description("Resume the workflow (alias for flow run)")
  .action(async () => {
    const { runFlowRun } = await import("./commands/flow.js");
    await runFlowRun({});
  });
```

- [ ] **Step 2: Build + smoke test** a foreach manifest end-to-end with the default dry-run JSON fixture: outline stage emitting `outline.json`, a foreach with a `requires_human_approval` draft step, `flow run` → paused with per-item reviews → `flow review --batch` → `flow continue` → completed, per-item artifacts present.
- [ ] **Step 3:** `npm test` → PASS. Commit: `feat: add flow review --batch and flow continue commands`.

---

### Task 5: Docs + final verification

- [ ] README command list: add `malaclaw flow review --batch` and `malaclaw flow continue`. CLAUDE.md workflow dir line: mention foreach scheduler.
- [ ] `npm run build && npm test && node dist/cli.js validate` all clean. Commit: `docs: document foreach scheduling and review commands`.

## Out of Scope (M6/M7)

- Scheduled digests (external cron calls `flow report` — already possible), follow-up workflow triggers from review labels.
- Budget enforcement, runtime fallback dispatch, isolated per-item workspaces (`requires_isolated_workspace` is respected only as a cap of 1 — actually deferred entirely to M7).
- Real runtimes (claude-code, codex, API, local).
