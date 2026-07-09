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
```

The condition is evaluated against `reports/metrics.json`. Hitting `max_rounds`
without satisfying the condition is a bounded completion, not an infinite loop.

## Loop Groups

Use `type: loop` when the improvement cycle spans multiple stages. This is the
shape LongWrite needs for AutoResearch-style quality loops where review,
routing, revision, and rebuild should repeat together:

```yaml
- type: loop
  id: quality
  max_rounds: 5
  stop_when: review_score >= 8.0
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
