# MalaClaw

MalaClaw is a workflow and runtime control plane for long-running multi-agent
projects.

It turns a project-local `malaclaw.yaml` into a resumable flow with file-backed
state, approval gates, validators, bounded retries, foreach fanout, and
pluggable workers such as Claude Code, Codex, deterministic scripts, and
OpenAI-compatible chat servers.

The first flagship consumer is LongWrite Agent: an AutoResearch-style long-form
writing workflow that uses MalaClaw for orchestration and worker runtime
dispatch.

## What It Is

MalaClaw has two related surfaces:

| Surface | Purpose |
| --- | --- |
| Workflow engine | Runs `workflow:` stages with state, retries, approvals, validators, foreach parallelism, revision loops, and runtime dispatch. |
| Project provisioners | Render agent/team workspaces for OpenClaw, Claude Code, Codex, and ClawTeam. This is useful, but no longer the only product center. |

This split matters:

- **Worker runtimes** execute workflow units: `dry-run`, `script`,
  `claude-code`, `codex`, `openai-compatible`, `openai-api`.
- **Provisioning runtimes** install/render team workspaces: `openclaw`,
  `claude-code`, `codex`, `clawteam`.

OpenClaw support remains a first-class adapter, but MalaClaw is now broader than
an OpenClaw installer.

## Feature Highlights

| Area | What it gives you |
| --- | --- |
| Workflow manifests | Declarative `workflow:` stages with owners, inputs, outputs, tools, validators, approvals, foreach item pipelines, and runtime/model overrides. |
| Flow engine | Resumable execution with `.malaclaw/flow/state.json`, event logs, checkpoints, retry handling, approval queues, and blocker reports. |
| Worker runtimes | `dry-run`, `script`, `claude-code`, `codex`, `openai-compatible`, and `openai-api`. |
| Runtime checks | `malaclaw flow runtimes` checks worker availability without spending model quota. |
| Runtime smoke/eval | `malaclaw flow smoke-runtime --runtime <id>` runs a one-stage workflow and writes a Markdown report. |
| Deterministic tools | `script` stages run structured commands without shell interpolation. |
| Project adapters | Optional install/provisioning into OpenClaw, Claude Code, Codex, and ClawTeam workspaces. |
| Teams and packs | Reusable agent/team templates, starter catalog, skill targeting, topology guidance, and telemetry. |

## Quick Start

```bash
npm install
npm run build
npm test
```

Check worker runtime availability:

```bash
node dist/cli.js flow runtimes
node dist/cli.js flow runtimes --runtime codex
```

Run no-cost and real-runtime smoke checks:

```bash
node dist/cli.js flow smoke-runtime --runtime dry-run --cleanup
node dist/cli.js flow smoke-runtime --runtime codex --cleanup
```

The smoke command writes reports like:

```text
reports/runtime-smoke-codex-<timestamp>.md
```

## Workflow Example

Add a `workflow:` block to `malaclaw.yaml`:

```yaml
version: 1
runtime: codex
project:
  id: mini-survey
  name: Mini Survey
workflow:
  runtime_policy:
    primary: dry-run
  stages:
    - id: outline
      owner: writer
      outputs:
        - outline.md
      validators:
        - required_output_exists
        - non_empty_markdown
      requires_human_approval: true
    - id: draft
      owner: writer
      inputs:
        - outline.md
      outputs:
        - draft.md
      runtime: codex
      validators:
        - required_output_exists
        - non_empty_markdown
```

Run it:

```bash
malaclaw validate
malaclaw flow run --runtime dry-run
malaclaw flow status
malaclaw flow approve approve-outline-001
malaclaw flow run --runtime codex
```

## Worker Runtimes

| Runtime | Use When | Notes |
| --- | --- | --- |
| `dry-run` | Tests, CI, contract checks | Writes placeholder artifacts; no model cost. |
| `script` | Deterministic tools and data preparation | Runs structured `cmd` + `args`; no shell interpolation. |
| `claude-code` | Real Claude Code headless work | Uses `claude -p`; model comes from stage `model:` or Claude CLI default. |
| `codex` | Real Codex headless work | Uses `codex exec`; suitable for file-editing stages. |
| `openai-compatible` | Cheap/local single-output text stages | Calls `/chat/completions`; writes one response into one concrete output. |
| `openai-api` | Alias for hosted OpenAI-compatible use | Uses the same runtime implementation as `openai-compatible`. |
| `ollama` | Free local single-output text stages | `openai-compatible` preset for `http://127.0.0.1:11434/v1`. |
| `anthropic-api` | Hosted Claude single-output text stages | Anthropic Messages API; needs `ANTHROPIC_API_KEY`. |
| `gemini-api` | Hosted Gemini single-output text stages | `generateContent` API; needs `GEMINI_API_KEY`. |

API runtime environment variables:

```bash
# openai-compatible / openai-api
export MALACLAW_OPENAI_BASE_URL=http://127.0.0.1:11434/v1
export MALACLAW_OPENAI_API_KEY=...
export MALACLAW_OPENAI_MODEL=...

# ollama alias
export MALACLAW_OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
export MALACLAW_OLLAMA_MODEL=llama3.1:8b

# anthropic-api / gemini-api
export MALACLAW_ANTHROPIC_API_KEY=...   # or ANTHROPIC_API_KEY
export MALACLAW_ANTHROPIC_MODEL=claude-sonnet-5
export MALACLAW_GEMINI_API_KEY=...      # or GEMINI_API_KEY / GOOGLE_API_KEY
export MALACLAW_GEMINI_MODEL=gemini-2.5-flash
```

For local servers, `MALACLAW_OPENAI_API_KEY` is optional when the base URL is
localhost. See [docs/workflow-runtime.md](./docs/workflow-runtime.md) for
choosing between single-shot API runtimes and agentic CLI harnesses, model
tiers, and budget approval gates.

## Provisioning Adapters

Set top-level `runtime:` when you want MalaClaw to render/install team
workspaces:

| Runtime | Manifest Value | Install Result |
| --- | --- | --- |
| OpenClaw | `openclaw` | Patches `~/.openclaw/openclaw.json` and creates agent workspaces. |
| Claude Code | `claude-code` | Generates `CLAUDE.md` for managed workspaces. |
| Codex | `codex` | Generates `AGENTS.md` for managed workspaces. |
| ClawTeam | `clawteam` | Exports `team.toml` and a spawn catalog. |

Example:

```yaml
version: 1
runtime: claude-code
packs:
  - id: dev-company
```

Then:

```bash
malaclaw install --dry-run
malaclaw install
```

## LongWrite Relationship

LongWrite is the writing product layer. MalaClaw is the runtime layer.

```text
LongWrite mode/config
  -> longwrite init
  -> longwrite.yaml + malaclaw.yaml
  -> malaclaw validate
  -> malaclaw flow run
  -> artifacts, reviews, reports, approvals
```

MalaClaw deliberately does not own writing-specific concepts such as citation
plans, novel bibles, or manuscript validation. It owns generic workflow
execution.

## Useful Commands

```bash
# workflow engine
malaclaw validate
malaclaw flow run
malaclaw flow status
malaclaw flow approve <approval-id>
malaclaw flow report
malaclaw flow review --batch
malaclaw flow continue
malaclaw flow runtimes
malaclaw flow smoke-runtime --runtime codex

# project provisioning
malaclaw init
malaclaw install --dry-run
malaclaw install
malaclaw diff
malaclaw doctor

# catalog and templates
malaclaw starter list
malaclaw starter suggest "<idea>"
malaclaw starter init <id> <dir>
malaclaw team show <id>
malaclaw agent show <id>
malaclaw skill show <id>

# dashboard
malaclaw dashboard
```

The dashboard includes a Flow monitor for active workflow runs and a LongWrite
tab for writing workspaces. The LongWrite tab reads `longwrite.yaml`, compiled
`malaclaw.yaml`, review cadence, runtime/model policy, current flow status,
token/cost telemetry, command hints, recent worker logs, and dashboard-launched
run output. It can start one LongWrite run per workspace, reject duplicate
runs, edit the stable `longwrite.yaml` project/research/review fields through
LongWrite's config validator, approve pending LongWrite gates, and generate
`reports/human-review-packet.md`, then links into the Flow monitor for deeper
logs and events. Workflow structure and mode recompilation still stay in the
LongWrite CLI/YAML path.

## Repository Layout

```text
src/lib/workflow/          # workflow engine, state, validators, runtime dispatch
src/lib/workflow/runtimes/ # dry-run, script, claude-code, codex, OpenAI-compatible
src/lib/adapters/          # install/provisioning adapters
templates/                 # reusable agents, teams, and skill metadata
packs/                     # reusable team bundles
starters/                  # curated starter manifests
demo-projects/             # generated starter catalog and cards
skills/malaclaw-cook/      # optional OpenClaw-facing manager skill
dashboard/                 # optional web dashboard
docs/                      # current docs and archived implementation plans
```

## Current MVP Status

Implemented:

- strict workflow schema and semantic validation,
- file-backed flow state and event logs,
- ordered stages and foreach item pipelines,
- approval gates and batch review,
- retries, blocker reports, and validation reports,
- bounded revision loops with `max_rounds` + `stop_when`,
- real worker runtimes for Claude Code and Codex,
- deterministic `script` runtime,
- OpenAI-compatible single-output runtime,
- runtime smoke/eval reports.

Still intentionally post-MVP:

- arbitrary DAG scheduling,
- automatic OS scheduler installation,
- policy-based auto-approval,
- full cost-budget enforcement and automatic fallback dispatch,
- UI-first workflow authoring.

## Documentation

- [docs/getting-started.md](./docs/getting-started.md)
- [docs/workflow-runtime.md](./docs/workflow-runtime.md)
- [docs/local-development.md](./docs/local-development.md)
- [docs/repo-workflow.md](./docs/repo-workflow.md)
- [docs/how-it-works.md](./docs/how-it-works.md)
- [docs/remote-access.md](./docs/remote-access.md)

## Reference Work

- [OpenClaw](https://github.com/openclaw/openclaw)
- [antfarm](https://github.com/snarktank/antfarm)
- [awesome-openclaw-usecases](https://github.com/hesamsheikh/awesome-openclaw-usecases)
- [awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills)
