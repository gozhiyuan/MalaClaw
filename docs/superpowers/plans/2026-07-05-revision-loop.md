# Bounded Revision Loop (Milestone 6 engine core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `max_rounds` + `stop_when` become real engine semantics: a standard stage with `max_rounds: N` re-runs up to N rounds, stopping early when `stop_when` (e.g. `review_score >= 8.0`) evaluates true against a workspace metrics artifact. Exhausting rounds without meeting the condition proceeds with a clearly recorded `revision_rounds_exhausted` event — bounded improvement, not failure.

**Design decisions (locked here):**

1. **Metrics contract:** `stop_when` metrics are read from `reports/metrics.json` — a flat JSON object of numbers (e.g. `{"review_score": 7.5}`), written/updated by whichever stage measures quality (typically the looping stage itself or its `validator_commands`). Missing file or metric ⇒ condition is *not met* (keep looping to the cap).
2. **Grammar:** `<metric> <op> <number>` with ops `>= > <= < ==` — parsed by regex, no expression engine (YAGNI).
3. **Loop semantics:** round 1 runs unconditionally; after each successful round, evaluate `stop_when` — met ⇒ stage succeeds; else next round with the unit's attempts reset and a seeded feedback line ("Revision round K of N: stop condition X not yet met (current: V)"). Cap reached unmet ⇒ stage **succeeds** with `revision_rounds_exhausted` event + validation-report note. Failures/pauses inside a round propagate exactly as today.
4. **Scope:** standard stages only (steps don't carry these fields — already true in the schema). `max_rounds` without `stop_when` = fixed N rounds. `stop_when` without `max_rounds` = **semantic error** (unbounded loop); malformed `stop_when` = semantic error.
5. **Resume:** rounds persist in unit state (`rounds` counter); an interrupted loop resumes with the remaining budget.

## Files

| File | Action | Responsibility |
| --- | --- | --- |
| `src/lib/workflow/stop-condition.ts` | Create | `parseStopCondition`, `evaluateStopCondition(workspaceDir, expr)` |
| `src/lib/workflow/state.ts` | Modify | `UnitState.rounds` counter |
| `src/lib/workflow/engine.ts` | Modify | Rounds loop around `runUnit` for standard stages; seeded round feedback |
| `src/lib/workflow/validate.ts` | Modify | Semantic checks: `stop_when` requires `max_rounds`; grammar must parse |
| `tests/flow-rounds.test.ts` | Create | Grammar, evaluation, fixed rounds, early stop, exhaustion, resume, semantic errors |
| Docs | Modify | CLAUDE.md/README notes; spec §3 gains the metrics contract (longwrite repo) |

## Tasks

- [ ] **Task 1: stop-condition module** (TDD): parse all five ops; reject garbage (`review_score is nice`, empty); evaluate against a temp workspace's `reports/metrics.json` — met/unmet/missing-file/missing-metric/non-numeric ⇒ `{met: boolean, current?: number}`.
- [ ] **Task 2: semantic validation**: `stop_when` without `max_rounds` → error; unparseable `stop_when` → error; valid combo → clean. Extend `WorkUnit`/`toWorkUnits` with the two fields (standard stages only).
- [ ] **Task 3: engine rounds loop** (TDD with an inline test runtime that bumps `review_score` per call): fixed-N rounds (`unit.rounds === N`, N `unit_started` events); early stop when the metric crosses the threshold (`rounds === 2` of 5, `stop_condition_met` event); exhaustion proceeds to next stage with `revision_rounds_exhausted` event; round feedback appears in the round-2 prompt; mid-loop blocker pause resumes with remaining rounds; all existing engine/foreach tests stay green.
- [ ] **Task 4: docs + full verify + commit**: CLAUDE.md workflow line, README feature row already covers flows (add metrics note to spec in longwrite repo), `npm run build && npm test`.

## Out of Scope

- Multi-stage loop groups (re-running review+revise together): the looping stage owns updating `reports/metrics.json`; group loops can come later if a mode needs them.
- Weakness routing (M6's follow-up-workflow triggers).
