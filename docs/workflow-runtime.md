# Workflow Runtime

This is the source-of-truth doc for MalaClaw's current MVP runtime model.

## Mental Model

MalaClaw separates project provisioning from workflow execution.

```text
malaclaw.yaml
  -> manifest/schema validation
  -> workflow engine
  -> WorkerRuntime
  -> files, reports, approvals, state
```

Provisioning adapters render team workspaces. Worker runtimes execute workflow
units. They are intentionally separate registries.

## Workflow State

Each flow writes project-local state under:

```text
.malaclaw/flow/
  state.json
  events.jsonl
  prompts/
  logs/
  checkpoints/
```

`state.json` is the resume point. `events.jsonl` is append-only history.
Prompts and logs make each worker call inspectable.

## WorkerRuntime Contract

A WorkerRuntime receives one unit of work:

- workspace directory,
- owner,
- rendered instructions,
- declared outputs,
- optional structured command,
- optional model,
- optional first-class image attachments,
- timeout.

It returns:

- outcome,
- produced files,
- optional message/log reference,
- optional usage/cost metadata.

The engine owns scheduling, retries, approvals, validation, and state. The
runtime only runs one unit headlessly.

## Runtime IDs

| ID | Kind | Purpose |
| --- | --- | --- |
| `dry-run` | deterministic | CI/tests and workflow contract checks. |
| `script` | deterministic | Structured local commands for research/tools/build steps. |
| `claude-code` | harness | Headless `claude -p` worker. |
| `codex` | harness | Headless `codex exec` worker. |
| `openai-compatible` | API/local | Single-output chat-completions worker. |
| `openai-api` | API alias | Hosted OpenAI-compatible use. |
| `ollama` | API/local alias | `openai-compatible` pointed at `http://127.0.0.1:11434/v1`. |
| `anthropic-api` | API | Single-output Anthropic Messages worker (`ANTHROPIC_API_KEY`). |
| `gemini-api` | API | Single-output Gemini generateContent worker (`GEMINI_API_KEY`). |

Use `malaclaw flow runtimes` before real runs.

## Execution Model: Resumable, Not Unattended

A flow is **resumable**: state, artifacts, and pending work survive any exit,
and re-running `flow run` continues from the first incomplete unit. Review
cadences generate agendas/guidance only; they do not install cron jobs.

For long-running jobs, `malaclaw flow supervise` keeps a resumable flow in
the foreground (run it under nohup/tmux/launchd to detach — MalaClaw does not
install OS schedulers). Quota/rate/runtime blockers get delayed retries with
exponential backoff (`--retry-minutes`, capped by `--max-retry-minutes`,
deadline `--max-hours`); approvals are polled but **never auto-approved**.
Configured `run_limits` are different: the supervisor stops immediately and
records the operator action required. Raise/remove the limit, then start a
new supervisor to resume completed work without reset. `.malaclaw/flow/
supervisor.json` records blocker type, next retry, and history for the
dashboard.

One supervisor or flow run per workspace: the CLI, dashboard, and supervisor
share a tokenized workspace lock (`.malaclaw/flow/lock.json`); stale locks
from dead processes are reclaimed automatically. A supervisor holds its lease
while it waits, so a second supervisor fails rather than racing retries.

`quota_exhausted` pauses with a blocker report — or, when
`runtime_policy.on_quota_exhausted: try_fallback` is set and a declared,
available fallback meets the unit's capabilities, the engine retries once on
that fallback and records requested/actual runtime and model. A cross-runtime
fallback uses that runtime's default model unless it pins one explicitly:

```yaml
runtime_policy:
  fallback:
    - runtime: codex
      model: gpt-5-mini
```

`permission_blocked`, `tool_missing`, and `model_unavailable` always pause.
`rate_limited` gets bounded in-process retries. Human and budget approval
gates are never auto-approved by anything, including the supervisor.

## Owner Roles

`owner:` on a stage is a role label. It becomes a real persona when the
workspace contains `roles/<owner>.md` — the engine injects that document into
every stage prompt for that owner (LongWrite compiles its agent templates
into these at init). Without the file, the owner remains a label in the
contract; it is NOT a separate agent system prompt.

## Run Limits (Guardrails, Not Meters)

```yaml
workflow:
  run_limits:
    max_recorded_tokens: 100000   # pause before the NEXT unit at this total
    max_unit_minutes: 10          # hard per-unit timeout (default 10 min)
    max_active_run_minutes: 120   # total worker time, excludes approval waits
    on_limit: pause               # the only policy: never silent downgrades
```

Distinguish three things the dashboard should never conflate: your
**provider's plan quota** (not observable by MalaClaw), **this run's
limits** (the guardrails above), and **observed telemetry** (recorded
tokens/time, including blocked attempts). Token totals are recorded after a
unit finishes, so a cap can overshoot by the work already in flight (up to the
active parallelism) — the per-unit
timeout bounds that. Costs: claude-code reports a cost figure (not billing
truth); codex reports combined tokens only; API runtimes report token counts
without dollar estimates.

## Runtime Capabilities

Every worker runtime declares what it can do; `malaclaw flow runtimes`
prints these, and `flow run` validates every stage against its resolved
runtime **before executing anything** — a mismatch fails fast with the full
list instead of dying mid-run.

Capabilities are contract flags, not marketing labels. They constrain which
YAML fields a runtime may execute.

| Capability | Meaning | YAML shape that requires it | Good fits |
| --- | --- | --- | --- |
| `single_output` | Can write one model response into one concrete output file. | A stage or foreach step with exactly one non-glob `outputs:` path. | API summary, classification, single review memo, one Markdown artifact. |
| `multi_file_edit` | Can read the workspace and create/update multiple declared files in one unit. | More than one concrete `outputs:` path, or any output path containing `*`. | Harness edits across chapters, a LaTeX source plus report, generated file sets. |
| `declared_command_tool` | Can expose the stage's exact `command:` as a controlled tool during generation, or run it directly for deterministic workers. | A stage with `command: { cmd, args }`. | Retrieval helper, validator, small local analyzer, one approved tool call. |
| `provider_tool_calling` | Can use provider-native tool/function-call protocol. | No direct YAML requirement today; used by runtime implementation and future tool routing. | API runtimes that can perform one controlled tool round. |
| `cli_harness_tools` | Has a full CLI agent harness: file tools, shell/debug loops, skills/MCP, provider permissions. | Any non-empty `allowed_tools:` list. | Claude Code/Codex stages that need Bash, web/search tools, MCP, or broad project editing. |
| `image_input` | Can attach workspace image files as actual multimodal prompt inputs. | Any non-empty `image_inputs:` list. | Codex visual QA of rendered PDFs, screenshots, plots, diagrams, or tables. |

Alpha matrix: `claude-code`/`codex` are full harnesses; `openai-api`,
`openai-compatible`, and `anthropic-api` are single-output with the
declared-command tool; `gemini-api` and `ollama` are single-output only;
`script` is deterministic; `dry-run` simulates every contract so any
workflow stays CI-runnable. The runtimes are deliberately not equivalent.
Currently `codex` is the runtime that declares `image_input`: it invokes
`codex exec --image <absolute-workspace-file>` for every resolved attachment.
MalaClaw never reads image bytes into the text `skills:` context, and it fails
closed before execution if an `image_inputs:` stage targets another runtime.

### How MalaClaw Infers Stage Requirements

MalaClaw derives required capabilities from the stage declaration:

| Stage declaration | Required capability | Why |
| --- | --- | --- |
| `outputs: [draft.md]` | `single_output` | The worker only needs to produce one concrete artifact. |
| `outputs: [paper/main.tex, build/manuscript.pdf]` | `multi_file_edit` | One unit is responsible for multiple files. |
| `outputs: [chapters/*.md]` | `multi_file_edit` | A glob means the unit may produce a file set. |
| `command: { cmd: node, args: [tools/retrieve.js] }` | `declared_command_tool` | The runtime must be able to invoke or own that exact command. |
| `allowed_tools: [Bash, WebSearch]` | `cli_harness_tools` | Only CLI harness runtimes can grant provider/harness tools. |
| `image_inputs: [reports/review/page-*.png]` | `image_input` | The runtime must attach rendered image evidence, not merely receive file paths in text. |
| `skills: [skills/style.md]` | none by itself | Skill files are injected into the prompt for any runtime; they do not grant tools. |
| `tools: [web_search]` | none by itself | `tools` is advisory prompt text. Use `allowed_tools` for real harness grants or a `command` for a controlled local tool. |

Example mismatch:

```yaml
workflow:
  stages:
    - id: build_paper
      owner: builder
      runtime: openai-api
      outputs:
        - paper/main.tex
        - build/manuscript.pdf
```

`openai-api` is a single-output API worker, so `flow run` rejects this before
execution:

```text
Stage/runtime capability mismatches (fix the manifest or pick another --runtime):
  - build_paper: declares 2 outputs but runtime "openai-api" is single-output — use claude-code, codex, or script
```

Split the work when using API runtimes:

```yaml
workflow:
  stages:
    - id: write_latex
      owner: writer
      runtime: openai-api
      outputs:
        - paper/main.tex

    - id: build_pdf
      owner: builder
      runtime: script
      needs: [write_latex]
      command:
        cmd: npm
        args: [run, build:pdf]
      outputs:
        - build/manuscript.pdf
```

Use `claude-code` or `codex` instead when one agentic stage should edit files,
run builds, inspect failures, and retry.

## Stage Tools and Skills

```yaml
- id: fact_check
  owner: skeptical-reviewer
  outputs: [reviews/fact-check.md]
  tools: [web_search]              # advisory: named in the prompt
  allowed_tools: [Bash, WebSearch] # harness grant: claude-code --allowedTools
  skills:                          # workspace docs injected into the prompt
    - skills/citation-style.md
```

`allowed_tools` is additive to the safe defaults (Read/Write/Edit/Glob/Grep)
and requires a `cli_harness_tools` runtime — granting Bash is a per-stage,
reviewable decision, never a default. `skills` files are read from the
workspace and inlined into the stage contract for every runtime.

## Choosing a Worker Runtime

The axis that matters is not just cost — it is **single-shot vs agentic**.
API/local runtimes send one prompt and write one response into one concrete
output file. `openai-compatible` / `openai-api` can also expose the stage's
declared structured `command` as a single tool call, but the model cannot invent
arbitrary commands. CLI harness runtimes read the workspace, write multiple
files, and run broader tool/debug loops.

| Stage shape | Use | Why |
| --- | --- | --- |
| Contract check, CI | `dry-run` | Free; validates workflow wiring only. |
| Deterministic transform (retrieval, scoring, build helpers) | `script` | Reproducible, no model. |
| One text artifact, low stakes (summaries, classification, review text) | `ollama` / `openai-compatible` | Cheapest real text; optional declared-command tool for OpenAI-compatible servers. |
| One text artifact, higher quality | `anthropic-api` / `gemini-api` / `openai-api` | Better hosted reasoning; still single-output. `openai-api` supports the declared-command tool path. |
| Multi-file edits, shell tools, build/debug loops, skills/MCP | `claude-code` / `codex` | Expensive but the only runtimes with a real tool harness. |

Rule of thumb: put agentic spend where judgment lives (outline, review,
revision, build) and route everything else down-tier. Single-output runtimes
return `tool_missing` if a stage declares more than one concrete output —
that is the contract telling you the stage needs a harness runtime.

## API Runtime Tool Boundary

For `openai-compatible` and `openai-api`, a stage may declare a structured
command:

```yaml
- id: summarize_search
  owner: analyst
  runtime: openai-api
  outputs: [reports/search-summary.md]
  command:
    cmd: node
    args: [tools/search.js]
```

The runtime exposes exactly one model tool, `run_declared_stage_command`. If the
model calls it, MalaClaw runs only that configured `cmd` + `args` without shell
interpolation, feeds the stdout/stderr back to the model, and writes the final
model response into the one concrete output. Use `script` when the command
itself should own the artifact; use `claude-code` or `codex` when the stage
needs unconstrained multi-file tool work.

## Budget Approval Gates

Mark expensive tiers with `requires_budget_approval`:

```yaml
workflow:
  model_tiers:
    strong:
      runtime: codex
      model: gpt-5.5
      requires_budget_approval: true
```

Any stage (or foreach step) resolving to that tier pauses the flow **before
spending**, queues an `approve-budget-<stage>-*` approval, and resumes
through `malaclaw flow approve <id>`. Granted budget approvals survive
resume and are distinct from post-success review gates
(`requires_human_approval`).

## Stage Runtime Selection

Resolution order:

1. stage or step `runtime:`,
2. stage or step `model_tier:`,
3. `workflow.runtime_policy.primary`,
4. CLI fallback passed to `malaclaw flow run --runtime <id>`.

Example:

```yaml
workflow:
  runtime_policy:
    primary: dry-run
  model_tiers:
    cheap:
      runtime: openai-compatible
      model: llama3.1
    strong:
      runtime: claude-code
  stages:
    - id: outline
      owner: writer
      model_tier: strong
      outputs: [outline.md]
    - id: summarize
      owner: analyst
      model_tier: cheap
      outputs: [summary.md]
```

Fallback is not silent. Runtime/model choices are recorded in flow state and
events.

## Advisor / Executor Pattern

MalaClaw can split expensive decision-making from bulk execution by using
`model_tiers`. A common setup is:

- `advisor`: high-judgment Claude runtime for strategy, outline, routing, and
  hard review.
- `reviewer`: cheaper strong model for routine review.
- `executor`: Codex, Claude Code, API runtime, or `script` for drafting,
  file edits, builds, and validators.

See [Advisor / Executor Runtime Split](patterns/advisor-executor.md) for the
full template. LongWrite also ships `codex_first` and
`claude_advisor_sonnet` runtime profiles that compile this pattern into
generated `malaclaw.yaml` files.

## Outcomes

Worker outcomes are normalized:

- `success`
- `validation_failed`
- `worker_error`
- `timeout`
- `rate_limited`
- `quota_exhausted`
- `permission_blocked`
- `tool_missing`
- `model_unavailable`
- `budget_exceeded`

Pause outcomes write `reports/<unit>-blocker.md` and leave the flow resumable.

## Approvals

Stages may set:

```yaml
requires_human_approval: true
```

The engine pauses and queues an approval:

```bash
malaclaw flow report
malaclaw flow approve <approval-id>
malaclaw flow review --batch
malaclaw flow continue
```

## Foreach Parallelism

Foreach stages expand items from a JSON artifact and run item-scoped steps with
bounded parallelism:

```yaml
- id: draft_sections
  type: foreach
  foreach: outline.sections
  item_name: section
  max_parallel: 4
  steps:
    - id: draft
      owner: writer
      outputs:
        - chapters/{{section.id}}.md
```

The engine respects workflow `max_parallel`, stage `max_parallel`, and runtime
`max_concurrent`.

## Revision Loops

Standard stages can run bounded improvement loops:

```yaml
- id: revise
  owner: editor
  outputs:
    - reports/metrics.json
  max_rounds: 5
  stop_when: review_score >= 8.0
  # Optional. Default is succeed, which records exhaustion as best effort.
  on_exhaustion: fail
```

The condition is evaluated against `reports/metrics.json`. Hitting `max_rounds`
without satisfying the condition is a bounded completion by default, not an
infinite loop. Set `on_exhaustion: fail` for a release gate: the stage fails
with `revision_rounds_exhausted` recorded in the event log, and downstream
stages do not run. Earlier artifacts remain available for `flow reopen`.

## Loop Groups

Use `type: loop` when the improvement cycle spans multiple stages. This is the
shape LongWrite needs for AutoResearch-style quality loops where review,
routing, revision, and rebuild should repeat together:

```yaml
- type: loop
  id: quality
  max_rounds: 5
  stop_when: review_score >= 8.0
  on_exhaustion: fail
  stages:
    - id: review
      owner: reviewer
      outputs:
        - reviews/scorecard.json
    - id: route
      owner: analyst
      inputs:
        - reviews/scorecard.json
      outputs:
        - reports/routing.md
    - id: revise
      owner: editor
      inputs:
        - reports/routing.md
      outputs:
        - chapters/*.md
    - id: rebuild
      owner: builder
      inputs:
        - chapters/*.md
      outputs:
        - build/manuscript.pdf
```

Each round scopes child unit keys as `<loop>-r<round>-<stage>`, for example
`quality-r2-revise`. That keeps prompts, logs, approvals, budget gates, events,
and usage telemetry inspectable per pass. The loop's own unit records completed
rounds, and the stop condition is evaluated after each complete child-stage
sequence.

## Repairing a Completed Prefix

When a validator or artifact contract changes, preserve earlier successful work
and explicitly reopen a top-level stage plus everything after it:

```bash
malaclaw flow migrate       # required after an additive manifest change
malaclaw flow reopen quality_loop
malaclaw flow supervise --runtime codex
```

`reopen` is narrower than `--reset`: it intentionally re-incurs runtime cost
only from the named stage forward. It refuses to alter a running flow.

For an unattended local run, use the built-in detached launcher instead of
depending on a terminal child process:

```bash
malaclaw flow supervise --runtime codex --detach
malaclaw flow operator-brief
```

## Stage Instructions

Use `instructions` for non-negotiable, stage-local constraints that belong in
the rendered worker contract rather than a shared agent persona:

```yaml
- id: evidence_revision
  owner: editor
  instructions:
    - Cite only evidence packet chunks as [source:<id>:p<paragraph>].
```

## Safe Stage Toggles

Optional workflow breadth can be disabled explicitly without hiding it from
state, events, or the dashboard:

```yaml
- id: venue_upgrade
  owner: source-curator
  skippable: true
  enabled: false
  disabled_reason: fast profile omits optional venue upgrades
  outputs:
    - sources/venue-upgrades.jsonl
```

`enabled: false` is valid only with `skippable: true` and a
`disabled_reason`. The engine records the unit as `skipped` and never invokes a
runtime for it. Semantic validation rejects a disabled producer when an enabled
downstream stage has that artifact as a required input. Make the downstream
input optional or declare a cached/user-provided replacement in
`workflow.external_inputs` instead.

Toggles apply to normal stages, foreach stages/steps, and loop groups/children.
They are configuration-time decisions, not a worker instruction: a model cannot
silently skip a declared quality gate.

## Smoke/Eval

Use smoke-runtime before expensive demos:

```bash
malaclaw flow smoke-runtime --runtime dry-run --cleanup
malaclaw flow smoke-runtime --runtime codex --cleanup
malaclaw flow smoke-runtime --runtime claude-code --cleanup
```

The command writes:

```text
reports/runtime-smoke-<runtime>-<timestamp>.md
```

The report captures availability, flow status, artifact presence, events, and
known failure modes.

## Artifact freshness and failure records

Every executable unit checks its required `inputs` before starting provider or
script work. A missing upstream artifact fails before spend and tells the
operator to retry or reopen from the producer stage. After a successful
attempt, every concrete output must have been created or refreshed by that
attempt; an unchanged file left by an earlier attempt cannot satisfy the next
validator accidentally.

An idempotent pass-through output is an explicit exception:

```yaml
- id: metadata_enrichment
  owner: source-curator
  inputs: [sources/corpus.jsonl]
  outputs: [sources/corpus.jsonl, reports/enrichment.md]
  allow_unchanged_outputs: [sources/corpus.jsonl]
```

MalaClaw writes an attempt receipt under
`.malaclaw/flow/artifacts/<unit>.json` after validation succeeds. Flow-state
saves use atomic replace, so a process or machine crash leaves either the old
complete state or the new complete state rather than truncated JSON.

Every failed boundary also appends a schema-validated record to
`reports/failures.ndjson`. Its `failure_class` is one of
`deterministic_contract`, `llm_contract`, `evidence_quality`,
`external_environment`, `operator_state`, or `unknown`, with a stable code,
stage, attempt, remediation, and recoverability flag. `unknown` is deliberate:
an unanticipated runtime throw remains visible and actionable until it earns a
more specific classification.
