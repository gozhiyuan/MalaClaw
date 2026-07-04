# MalaClaw Workflow Schema + Validate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class `workflow:` support to `malaclaw.yaml` — Zod schemas for normal stages and `foreach` item pipelines (nested steps, `max_parallel`), semantic validation (stage/step owners, duplicate ids, template-aware input provenance), resolver integration, and `malaclaw validate` coverage. No execution engine yet (that is Milestone 2).

**Architecture:** Workflow schemas join the other Zod schemas in `src/lib/schema.ts` (repo convention: all data shapes live there). The parsed, default-applied `WorkflowDef` type IS the workflow IR — no separate IR layer. Semantic checks that need loaded templates (owner existence) live in a new `src/lib/workflow/validate.ts` module, which is the future home of the flow engine. `resolveManifest()` fails hard on workflow errors and surfaces warnings; `malaclaw validate` gains a project-manifest section.

**Tech Stack:** TypeScript, Zod v3 (`z.ZodIssueCode.custom` syntax), Vitest 4, commander. Node ≥ 22. All work in the MalaClaw repo.

**Spec:** `longwrite-agent/docs/superpowers/specs/2026-07-04-longwrite-malaclaw-flows-design.md` (Milestone 1).

**Working conventions for every task:**
- Run `npm run build` before any CLI smoke test — the CLI runs from `dist/`, not `src/`.
- Run targeted tests with `npx vitest run tests/<file>.test.ts`.
- Field names in YAML are snake_case (`requires_human_approval`), matching existing manifest style.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/lib/schema.ts` | Modify | Add `WorkflowRetry`, `WorkflowStep`, `StandardStage`, `ForeachStage`, `WorkflowStage` (union), `WorkflowDef` schemas; add `workflow:` to `Manifest` |
| `src/lib/workflow/validate.ts` | Create | `validateWorkflowSemantics()` (owner/input checks), `matchesArtifact()` — pure, no I/O |
| `src/lib/manifest-validate.ts` | Create | `validateProjectManifest()` — loads + resolves the project manifest (kept out of `workflow/validate.ts` to avoid a resolver import cycle) |
| `src/lib/resolver.ts` | Modify | Validate workflow during `resolveManifest()`; add `workflow` + `workflowWarnings` to `ResolveResult` |
| `src/commands/validate.ts` | Modify | Add project-manifest validation section to `malaclaw validate` output |
| `tests/workflow-schema.test.ts` | Create | Schema-level valid/invalid cases |
| `tests/workflow-validate.test.ts` | Create | Semantic validator unit tests |
| `tests/workflow-resolver.test.ts` | Create | Resolver integration tests (uses bundled `dev-company` pack) |
| `tests/manifest-validate.test.ts` | Create | `validateProjectManifest()` against temp project dirs |
| `CLAUDE.md` | Modify | Add `WorkflowDef` row to schema reference table |

---

### Task 1: Workflow Zod Schemas

**Files:**
- Test: `tests/workflow-schema.test.ts`
- Modify: `src/lib/schema.ts` (append after the `Manifest` section, ~line 235)

- [ ] **Step 1: Write the failing tests**

Create `tests/workflow-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  WorkflowStage,
  WorkflowStep,
  StandardStage,
  ForeachStage,
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
      requires_human_approval: true,
      retry: { max_attempts: 3 },
      max_rounds: 5,
      stop_when: "review_score >= 8.0",
    });
    expect(stage.retry?.max_attempts).toBe(3);
    expect(stage.max_rounds).toBe(5);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/workflow-schema.test.ts`
Expected: FAIL — `WorkflowStage`, `WorkflowDef` are not exported from schema.js.

- [ ] **Step 3: Implement the schemas**

In `src/lib/schema.ts`, insert a new section immediately BEFORE the `// ── Project manifest (malaclaw.yaml)` comment (~line 235):

```ts
// ── Workflow definition (malaclaw.yaml workflow:) ───────────────────────────
// The parsed, default-applied WorkflowDef is the framework-neutral workflow IR.
// Execution semantics (engine, WorkerRuntime) arrive in a later milestone.
//
// These schemas are .strict() — unlike the rest of this file — because workflow
// YAML is user-edited and a silently-stripped typo (requiresHumanApproval,
// maxAttempts) could drop an approval gate. Fail closed on unknown keys.

export const WorkflowRetry = z
  .object({
    max_attempts: z.number().int().min(1).max(10).default(2),
  })
  .strict();

// Fields shared by normal stages and foreach inner steps.
const workUnitFields = {
  id: z.string().min(1),
  title: z.string().optional(),
  owner: z.string().min(1),
  inputs: z.array(z.string()).default([]),
  // Used if present, never required: exempt from the engine's input-existence
  // check (future milestone) and from input-provenance warnings.
  optional_inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  validators: z.array(z.string()).default([]),
  requires_human_approval: z.boolean().default(false),
  retry: WorkflowRetry.optional(),
};

// Inner step of a foreach item pipeline. Output paths may use {{item.id}}
// templates — opaque strings here, resolved by the engine.
export const WorkflowStep = z.object(workUnitFields).strict();

export const StandardStage = z
  .object({
    ...workUnitFields,
    type: z.literal("stage").optional(),
    max_rounds: z.number().int().min(1).optional(),
    stop_when: z.string().optional(),
  })
  .strict();

export const ForeachStage = z
  .object({
    type: z.literal("foreach"),
    id: z.string().min(1),
    title: z.string().optional(),
    foreach: z.string().min(1), // path into an artifact, e.g. "outline.sections"
    item_name: z.string().default("item"),
    max_parallel: z.number().int().min(1).default(1),
    steps: z.array(WorkflowStep).min(1),
  })
  .strict()
  .superRefine((stage, ctx) => {
    const seen = new Set<string>();
    stage.steps.forEach((step, i) => {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "id"],
          message: `Duplicate step id "${step.id}"`,
        });
      }
      seen.add(step.id);
    });
  });

// Not a discriminatedUnion: normal stages may omit `type`, and Zod v3
// discriminated unions require the discriminator on every member. ForeachStage
// is listed first but order does not affect correctness — strictness makes the
// two shapes mutually exclusive.
export const WorkflowStage = z.union([ForeachStage, StandardStage]);

export const WorkflowDef = z
  .object({
    mode: z.string().optional(),
    artifact_type: z.string().optional(),
    // Artifacts supplied by the user or environment (expected to exist)
    // rather than produced by a stage — exempt from provenance warnings.
    external_inputs: z.array(z.string()).default([]),
    // Global cap on concurrently running foreach items across the workflow.
    max_parallel: z.number().int().min(1).default(2),
    stages: z.array(WorkflowStage).min(1),
  })
  .strict()
  .superRefine((wf, ctx) => {
    const seen = new Set<string>();
    wf.stages.forEach((stage, i) => {
      if (seen.has(stage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", i, "id"],
          message: `Duplicate stage id "${stage.id}"`,
        });
      }
      seen.add(stage.id);
    });
  });

export type WorkflowRetry = z.infer<typeof WorkflowRetry>;
export type WorkflowStep = z.infer<typeof WorkflowStep>;
export type StandardStage = z.infer<typeof StandardStage>;
export type ForeachStage = z.infer<typeof ForeachStage>;
export type WorkflowStage = z.infer<typeof WorkflowStage>;
export type WorkflowDef = z.infer<typeof WorkflowDef>;
```

Then add the field to `Manifest` (currently ~line 264):

```ts
export const Manifest = z.object({
  version: z.number().default(1),
  runtime: RuntimeTarget.default("openclaw"),
  project: ManifestProject.optional(),
  packs: z.array(ManifestPackRef).optional().default([]),
  skills: z.array(ManifestSkillRef).optional().default([]),
  workflow: WorkflowDef.optional(),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow-schema.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `npm test`
Expected: PASS — no existing test parses a manifest with a `workflow` key, so nothing else should change.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schema.ts tests/workflow-schema.test.ts
git commit -m "feat: add WorkflowDef/WorkflowStage schemas and Manifest workflow field"
```

---

### Task 2: Semantic Workflow Validator

**Files:**
- Test: `tests/workflow-validate.test.ts`
- Create: `src/lib/workflow/validate.ts`

Schema-level checks (Task 1) catch shape errors. This module catches semantic errors that need context: does the stage owner exist among resolved agents; is a declared input actually produced by an earlier stage (warning only — inputs may legitimately be user-provided files).

- [ ] **Step 1: Write the failing tests**

Create `tests/workflow-validate.test.ts`:

```ts
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
        { id: "revise", owner: "chapter-writer", inputs: ["chapters/*.md"], optional_inputs: [], outputs: ["chapters/*.md"] },
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/workflow-validate.test.ts`
Expected: FAIL — cannot resolve `../src/lib/workflow/validate.js`.

- [ ] **Step 3: Implement the validator**

Create `src/lib/workflow/validate.ts`:

```ts
import type { WorkflowDef, WorkflowStage } from "../schema.js";

export type WorkflowValidationResult = {
  errors: string[];
  warnings: string[];
};

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert an artifact pattern to a regex. Both `*` globs and `{{item.id}}`
 *  templates match arbitrary path content. */
function patternToRegex(pattern: string): RegExp {
  const wildcarded = pattern.replace(/\{\{[^}]+\}\}/g, "*");
  return new RegExp("^" + wildcarded.split("*").map(escapeRegex).join(".*") + "$");
}

/** True when a produced artifact path satisfies a declared input path.
 *  Either side may contain `*` globs or `{{...}}` templates. */
export function matchesArtifact(produced: string, input: string): boolean {
  if (produced === input) return true;
  return patternToRegex(produced).test(input) || patternToRegex(input).test(produced);
}

type WorkUnit = {
  label: string;
  owner: string;
  inputs: string[];
  outputs: string[];
};

/** Flatten a stage into ordered work units. Foreach steps keep their declared
 *  order, so within an item pipeline earlier steps' outputs count as produced
 *  for later steps' inputs. */
function toWorkUnits(stage: WorkflowStage): WorkUnit[] {
  if ("steps" in stage) {
    return stage.steps.map((step) => ({
      label: `${stage.id}.${step.id}`,
      owner: step.owner,
      inputs: step.inputs,
      outputs: step.outputs,
    }));
  }
  return [{ label: stage.id, owner: stage.owner, inputs: stage.inputs, outputs: stage.outputs }];
}

/** Semantic checks that need resolved context (schema-shape checks live in Zod).
 *  Errors block install; warnings are informational. */
export function validateWorkflowSemantics(
  workflow: WorkflowDef,
  availableOwnerIds: Set<string>,
): WorkflowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Seed with user/environment-provided artifacts so they never trigger warnings.
  const producedOutputs: string[] = [...workflow.external_inputs];

  for (const stage of workflow.stages) {
    for (const unit of toWorkUnits(stage)) {
      if (!availableOwnerIds.has(unit.owner)) {
        errors.push(
          `Stage "${unit.label}": owner "${unit.owner}" is not an agent in any selected team or attached agent`,
        );
      }
      for (const input of unit.inputs) {
        if (!producedOutputs.some((out) => matchesArtifact(out, input))) {
          warnings.push(
            `Stage "${unit.label}": input "${input}" is not produced by any earlier stage (fine if it is user-provided)`,
          );
        }
      }
      producedOutputs.push(...unit.outputs);
    }
  }

  return { errors, warnings };
}
```

Note: `fanout_over` (e.g. `outline.sections`) references *inside* an artifact, not an artifact path — validating it requires the engine's outline contract, so it is deliberately unchecked in this milestone.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow/validate.ts tests/workflow-validate.test.ts
git commit -m "feat: add semantic workflow validator (owners, input provenance, glob matching)"
```

---

### Task 3: Resolver Integration

**Files:**
- Test: `tests/workflow-resolver.test.ts`
- Modify: `src/lib/resolver.ts`

`resolveManifest()` is the reconciliation point for installs, so workflow errors must fail resolution. Owner ids come from resolved pack agents (template ids like `pm`, `tech-lead`) plus the project's attached agents.

- [ ] **Step 1: Write the failing tests**

Create `tests/workflow-resolver.test.ts` (uses the bundled `dev-company` pack, whose agents include `pm` and `tech-lead` — same pack existing resolver tests rely on):

```ts
import { describe, it, expect } from "vitest";
import { resolveManifest } from "../src/lib/resolver.js";

describe("resolveManifest with workflow", () => {
  it("resolves a manifest whose workflow owners exist in the pack", async () => {
    const result = await resolveManifest(
      {
        version: 1,
        runtime: "openclaw",
        packs: [{ id: "dev-company" }],
        skills: [],
        workflow: {
          external_inputs: [],
          max_parallel: 2,
          stages: [
            { id: "plan", owner: "pm", inputs: [], optional_inputs: [], outputs: ["plan.md"], tools: [], validators: [], requires_human_approval: false },
            { id: "build", owner: "tech-lead", inputs: ["plan.md"], optional_inputs: [], outputs: ["src/*.ts"], tools: [], validators: [], requires_human_approval: false },
          ],
        },
      },
      { projectDir: "/tmp/acme-web" },
    );
    expect(result.workflow).toBeDefined();
    expect(result.workflow?.stages).toHaveLength(2);
    expect(result.workflowWarnings).toEqual([]);
  });

  it("surfaces input-provenance warnings without failing", async () => {
    const result = await resolveManifest(
      {
        version: 1,
        runtime: "openclaw",
        packs: [{ id: "dev-company" }],
        skills: [],
        workflow: {
          external_inputs: [],
          max_parallel: 2,
          stages: [
            { id: "build", owner: "tech-lead", inputs: ["plan.md"], optional_inputs: [], outputs: [], tools: [], validators: [], requires_human_approval: false },
          ],
        },
      },
      { projectDir: "/tmp/acme-web" },
    );
    expect(result.workflowWarnings).toHaveLength(1);
    expect(result.workflowWarnings[0]).toContain("plan.md");
  });

  it("throws when a workflow stage owner does not exist", async () => {
    await expect(
      resolveManifest(
        {
          version: 1,
          runtime: "openclaw",
          packs: [{ id: "dev-company" }],
          skills: [],
          workflow: {
            external_inputs: [],
            max_parallel: 2,
            stages: [
              { id: "plan", owner: "ghost-writer", inputs: [], optional_inputs: [], outputs: [], tools: [], validators: [], requires_human_approval: false },
            ],
          },
        },
        { projectDir: "/tmp/acme-web" },
      ),
    ).rejects.toThrow(/ghost-writer/);
  });

  it("validates owners inside foreach steps", async () => {
    await expect(
      resolveManifest(
        {
          version: 1,
          runtime: "openclaw",
          packs: [{ id: "dev-company" }],
          skills: [],
          workflow: {
            external_inputs: [],
            max_parallel: 2,
            stages: [
              {
                type: "foreach",
                id: "items",
                foreach: "outline.sections",
                item_name: "item",
                max_parallel: 2,
                steps: [
                  {
                    id: "draft",
                    owner: "ghost-writer",
                    inputs: [],
                    optional_inputs: [],
                    outputs: [],
                    tools: [],
                    validators: [],
                    requires_human_approval: false,
                  },
                ],
              },
            ],
          },
        },
        { projectDir: "/tmp/acme-web" },
      ),
    ).rejects.toThrow(/ghost-writer/);
  });

  it("leaves workflow undefined for manifests without one", async () => {
    const result = await resolveManifest(
      { version: 1, runtime: "openclaw", packs: [{ id: "dev-company" }], skills: [] },
      { projectDir: "/tmp/acme-web" },
    );
    expect(result.workflow).toBeUndefined();
    expect(result.workflowWarnings).toEqual([]);
  });
});
```

Note: the inline manifests spell out stage defaults (`inputs: []`, etc.) because they are typed `Manifest` objects, not raw YAML passing through `Manifest.parse()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/workflow-resolver.test.ts`
Expected: FAIL — `result.workflow` / `result.workflowWarnings` do not exist; unknown owner does not throw.

- [ ] **Step 3: Implement resolver integration**

In `src/lib/resolver.ts`:

Add to the imports:

```ts
import { validateWorkflowSemantics } from "./workflow/validate.js";
```

Add `WorkflowDef` to the type-only import from `./schema.js`:

```ts
import type {
  Manifest,
  Lockfile,
  LockedPack,
  LockedSkill,
  LockedProject,
  AgentDef,
  TeamDef,
  SkillEntry,
  WorkflowDef,
} from "./schema.js";
```

Extend `ResolveResult`:

```ts
export type ResolveResult = {
  project: ResolvedProjectMeta;
  packs: ResolvedPack[];
  skills: ResolvedSkill[];
  workflow?: WorkflowDef;
  workflowWarnings: string[];
  lockfile: Lockfile;
};
```

In `resolveManifest()`, after the skills-resolution block and before `// Build lockfile`, insert:

```ts
  // Validate workflow against resolved agents
  let workflow: WorkflowDef | undefined;
  const workflowWarnings: string[] = [];
  if (manifest.workflow) {
    const ownerIds = new Set<string>();
    for (const pack of packs) {
      for (const agent of pack.agents) ownerIds.add(agent.agentDef.id);
    }
    for (const attached of project.attachedAgents) ownerIds.add(attached);

    const { errors, warnings } = validateWorkflowSemantics(manifest.workflow, ownerIds);
    if (errors.length > 0) {
      throw new Error(
        `Workflow validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
    workflowWarnings.push(...warnings);
    workflow = manifest.workflow;
  }
```

And include both fields in the returned object:

```ts
  return { project, packs, skills, workflow, workflowWarnings, lockfile };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Existing resolver/install/diff tests destructure only the fields they use, so the two added fields are non-breaking — but if any test asserts on the exact `ResolveResult` shape, fix it here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resolver.ts tests/workflow-resolver.test.ts
git commit -m "feat: validate workflow owners during manifest resolution"
```

---

### Task 4: `malaclaw validate` Covers the Project Manifest

**Files:**
- Test: `tests/manifest-validate.test.ts`
- Create: `src/lib/manifest-validate.ts`
- Modify: `src/commands/validate.ts`

Currently `malaclaw validate` only checks bundled templates. Add a project-manifest section: if `malaclaw.yaml` exists in the working directory, parse it and resolve it (which now includes workflow semantics). The logic lives in a lib module so it is testable without `process.exit`. It gets its own file — NOT `workflow/validate.ts` — because it imports `resolver.ts`, which already imports `workflow/validate.ts`; keeping them separate avoids a circular import.

- [ ] **Step 1: Write the failing tests**

Create `tests/manifest-validate.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateProjectManifest } from "../src/lib/manifest-validate.js";

const tempDirs: string[] = [];

async function makeProject(yaml: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-test-"));
  tempDirs.push(dir);
  await fs.writeFile(path.join(dir, "malaclaw.yaml"), yaml, "utf-8");
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("validateProjectManifest", () => {
  it("reports found=false when no malaclaw.yaml exists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-test-"));
    tempDirs.push(dir);
    const result = await validateProjectManifest(dir);
    expect(result.found).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid workflow-enabled manifest", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
      owner: pm
      outputs:
        - plan.md
    - id: build
      owner: tech-lead
      inputs:
        - plan.md
`);
    const result = await validateProjectManifest(dir);
    expect(result.found).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a manifest with an unknown stage owner", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
      owner: ghost-writer
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("ghost-writer");
  });

  it("rejects a manifest with duplicate stage ids", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
      owner: pm
    - id: plan
      owner: pm
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n").toLowerCase()).toContain("duplicate stage id");
  });

  it("rejects a manifest whose stage is missing required fields", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("accepts a manifest with a foreach stage", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: outline
      owner: pm
      outputs:
        - outline.json
    - id: draft_items
      type: foreach
      foreach: outline.sections
      max_parallel: 4
      steps:
        - id: draft
          owner: tech-lead
          inputs:
            - outline.json
          outputs:
            - chapters/{{item.id}}.md
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("surfaces provenance warnings for a valid manifest", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: build
      owner: tech-lead
      inputs:
        - plan.md
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/manifest-validate.test.ts`
Expected: FAIL — `validateProjectManifest` is not exported.

- [ ] **Step 3: Implement `validateProjectManifest`**

Create `src/lib/manifest-validate.ts`:

```ts
import fs from "node:fs/promises";
import { ZodError } from "zod";
import { loadManifest } from "./loader.js";
import { resolveManifest } from "./resolver.js";
import { resolveManifestPath } from "./paths.js";

export type ManifestValidation = {
  found: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
};

/** Validate the project's malaclaw.yaml: Zod shape + full resolution
 *  (pack/team/agent loading + workflow semantics). Safe to call when no
 *  manifest exists — returns found=false. */
export async function validateProjectManifest(projectDir?: string): Promise<ManifestValidation> {
  const manifestPath = resolveManifestPath(projectDir);
  try {
    await fs.access(manifestPath);
  } catch {
    return { found: false, ok: true, errors: [], warnings: [] };
  }

  try {
    const manifest = await loadManifest(projectDir);
    const result = await resolveManifest(manifest, { projectDir });
    return { found: true, ok: true, errors: [], warnings: result.workflowWarnings };
  } catch (err) {
    const errors =
      err instanceof ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
        : [err instanceof Error ? err.message : String(err)];
    return { found: true, ok: false, errors, warnings: [] };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/manifest-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the validate command**

In `src/commands/validate.ts`, replace the whole file with:

```ts
import { loadAllAgents, loadAllTeams, loadAllSkills, loadAllPacks } from "../lib/loader.js";
import { validateProjectManifest } from "../lib/manifest-validate.js";
import { ZodError } from "zod";

type ValidationResult = {
  file: string;
  ok: boolean;
  errors: string[];
};

export async function runValidate(): Promise<void> {
  const results: ValidationResult[] = [];

  const runners: Array<{ label: string; fn: () => Promise<unknown[]> }> = [
    { label: "agents", fn: loadAllAgents },
    { label: "teams", fn: loadAllTeams },
    { label: "skills", fn: loadAllSkills },
    { label: "packs", fn: loadAllPacks },
  ];

  for (const runner of runners) {
    try {
      await runner.fn();
      results.push({ file: runner.label, ok: true, errors: [] });
    } catch (err) {
      const msgs = err instanceof ZodError
        ? err.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`)
        : [err instanceof Error ? err.message : String(err)];
      results.push({ file: runner.label, ok: false, errors: msgs });
    }
  }

  const manifest = await validateProjectManifest();
  if (manifest.found) {
    results.push({ file: "malaclaw.yaml", ok: manifest.ok, errors: manifest.errors });
  }

  let allOk = true;
  for (const r of results) {
    if (r.ok) {
      console.log(`✓ ${r.file}`);
    } else {
      allOk = false;
      console.log(`✗ ${r.file}`);
      for (const e of r.errors) console.log(`    ${e}`);
    }
  }

  for (const w of manifest.warnings) {
    console.log(`⚠ malaclaw.yaml: ${w}`);
  }

  if (!allOk) {
    console.log("\nValidation failed. Fix the errors above.");
    process.exit(1);
  } else {
    console.log("\n✓ All templates valid.");
  }
}
```

- [ ] **Step 6: Build and smoke-test the CLI**

```bash
npm run build
node dist/cli.js validate
```

Expected: `✓ agents`, `✓ teams`, `✓ skills`, `✓ packs`, no `malaclaw.yaml` line (repo root has no manifest), `✓ All templates valid.`

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/manifest-validate.ts src/commands/validate.ts tests/manifest-validate.test.ts
git commit -m "feat: validate project manifest (including workflow) in malaclaw validate"
```

---

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md` (Schema Reference table)
- Modify: `README.md` (feature table row)

- [ ] **Step 1: Add WorkflowDef to the CLAUDE.md schema table**

In `CLAUDE.md`, in the "Schema Reference (src/lib/schema.ts)" table, add after the `Manifest` row:

```markdown
| `WorkflowDef` | `malaclaw.yaml` `workflow:` | Stage-based workflow IR: normal stages + foreach item pipelines, owners, artifacts, validators, approval gates, parallelism caps (no execution engine yet) |
```

- [ ] **Step 2: Add a README feature-table row**

In `README.md`, in the "Feature Highlights" table, add after the "Team orchestration" row:

```markdown
| Workflow manifests | Declare stage-based workflows (`workflow:`) with owners, artifacts, validators, and approval gates — validated by `malaclaw validate` |
```

- [ ] **Step 3: Verify docs render and nothing else references the old validate behavior**

Run: `grep -rn "workflow:" README.md CLAUDE.md | head`
Expected: the two new rows appear.

- [ ] **Step 4: Final full verification**

```bash
npm run build && npm test && node dist/cli.js validate
```

Expected: build clean, all tests pass, validate prints all `✓`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document workflow schema support"
```

---

## Out of Scope (later milestones)

- Flow engine, state files, events, checkpoints (Milestone 2, with DryRunRuntime).
- `WorkerRuntime` interface and claude-code/codex implementations (Milestone 3).
- `manuscript-writing` pack, writing agents/teams, LongWrite CLI, planner skill (Milestone 4 — LongWrite repo).
- Rendering workflow guidance into agent workspace files.
- Lockfile changes: the lockfile intentionally does not record the workflow yet; the engine milestone decides what resolved-workflow state belongs there.
