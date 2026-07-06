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

Use `malaclaw flow runtimes` before real runs.

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
