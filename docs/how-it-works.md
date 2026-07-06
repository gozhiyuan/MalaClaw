# How MalaClaw Works

MalaClaw is a runtime-agnostic control plane with two layers:

1. a workflow engine for executing long-running projects,
2. provisioning adapters for rendering team workspaces into agent tools.

The workflow engine is the current MVP center.

## Architecture

```text
malaclaw.yaml
  ├─ project metadata
  ├─ optional packs/skills for provisioning
  └─ workflow
       ├─ stages / foreach steps
       ├─ inputs / outputs
       ├─ validators / validator_commands
       ├─ approvals / retries
       └─ runtime/model choices

malaclaw validate
  -> Zod schema parse
  -> owner/runtime/path semantic checks

malaclaw flow run
  -> load or initialize .malaclaw/flow/state.json
  -> render unit prompt
  -> dispatch to WorkerRuntime
  -> validate outputs
  -> append events and reports
  -> pause, retry, or continue
```

## Workflow Engine Modules

| Module | Responsibility |
| --- | --- |
| `src/lib/schema.ts` | Manifest and workflow Zod schemas. |
| `src/lib/workflow/engine.ts` | Scheduler, retries, approvals, revision loops, runtime dispatch. |
| `src/lib/workflow/state.ts` | Flow state, events, prompts, logs, checkpoints. |
| `src/lib/workflow/validators.ts` | Built-in artifact validators. |
| `src/lib/workflow/foreach.ts` | Foreach item expansion and output template resolution. |
| `src/lib/workflow/stop-condition.ts` | Bounded revision loop condition evaluation. |
| `src/lib/workflow/runtimes/` | WorkerRuntime implementations. |

## Worker Runtime Boundary

The engine sends a rendered prompt plus structured metadata to a runtime.

```text
Stage contract
  -> WorkerRuntime.runStage()
  -> files on disk
  -> StageRunResult
```

The runtime does not decide scheduling or approval policy. The engine does.

## File-Backed State

Every workflow project gets:

```text
.malaclaw/flow/
  state.json       # resumable flow state
  events.jsonl     # append-only event log
  prompts/         # rendered prompt per attempt
  logs/            # worker stdout/stderr/API responses
  checkpoints/     # prior concrete outputs before reruns
```

This is intentionally inspectable and git-friendly.

## Validators

Built-in validators include:

- `required_output_exists`
- `non_empty_markdown`
- `json_parseable`
- `jsonl_parseable`

Stages may also declare external validators:

```yaml
validator_commands:
  - cmd: node
    args: [dist/cli.js, validate, research, .]
```

This is how LongWrite adds writing-domain checks without putting them into
MalaClaw.

## Approvals

Approval gates are explicit:

```yaml
requires_human_approval: true
```

The flow pauses and records pending approvals. The user can inspect and approve:

```bash
malaclaw flow report
malaclaw flow approve <approval-id>
malaclaw flow review --batch
```

## Runtime Dispatch

Runtime selection is resolved per unit:

```text
stage.runtime
  -> stage.model_tier.runtime
  -> workflow.runtime_policy.primary
  -> CLI --runtime fallback
```

Registered WorkerRuntimes:

- `dry-run`
- `script`
- `claude-code`
- `codex`
- `openai-compatible`
- `openai-api`

## Provisioning Adapters

Provisioning is still supported, but separate.

```text
malaclaw install
  -> resolve packs/teams/agents/skills
  -> render workspace files
  -> dispatch to adapter
```

Adapters:

- `openclaw`: patch OpenClaw config and create agent workspaces,
- `claude-code`: write `CLAUDE.md`,
- `codex`: write `AGENTS.md`,
- `clawteam`: write `team.toml` and spawn catalog.

Provisioning state is tracked through `malaclaw.lock`, `~/.malaclaw/runtime.json`,
and optional runtime telemetry.

## LongWrite Integration

LongWrite compiles writing modes into MalaClaw workflows.

LongWrite owns:

- writing modes,
- research artifacts,
- citation and source validation,
- writing-specific reports.

MalaClaw owns:

- workflow scheduling,
- runtime dispatch,
- approvals,
- retries,
- artifact contract checks.

This is the intended boundary for other product layers too.
