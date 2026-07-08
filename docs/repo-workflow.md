# Using This Repo

This repo contains both the MalaClaw workflow runtime and the older
team/provisioning catalog.

Use the workflow runtime when you want to run a stage-based project. Use
provisioning when you want to render teams into OpenClaw, Claude Code, Codex, or
ClawTeam workspaces.

## Install the CLI

```bash
npm install
npm run build
npm link
```

Or use `node dist/cli.js` directly.

## Main Path: Workflow Projects

A workflow project is any directory with `malaclaw.yaml` and a `workflow:`
block.

```bash
cd /path/to/project
malaclaw validate
malaclaw flow run --runtime dry-run
malaclaw flow status
```

If the flow pauses:

```bash
malaclaw flow report
malaclaw flow approve <approval-id>
malaclaw flow continue
```

If the flow reports a blocker:

```bash
cat reports/*-blocker.md
```

Fix the issue, then run:

```bash
malaclaw flow continue
```

## Runtime Checks

Before real model runs:

```bash
malaclaw flow runtimes
malaclaw flow smoke-runtime --runtime dry-run --cleanup
malaclaw flow smoke-runtime --runtime codex --cleanup
```

Use smoke reports as evidence for runtime availability and failure modes.

## LongWrite Projects

LongWrite creates MalaClaw workflow projects:

```text
longwrite init
  -> longwrite.yaml
  -> malaclaw.yaml
  -> templates/
  -> malaclaw flow run
```

In that setup, LongWrite owns writing-specific validation and artifacts.
MalaClaw owns workflow execution.

## Provisioning Path

For team/workspace provisioning:

```bash
malaclaw init
malaclaw install --dry-run
malaclaw install
malaclaw doctor
```

Top-level `runtime:` selects the provisioning adapter:

```yaml
runtime: openclaw
runtime: claude-code
runtime: codex
runtime: clawteam
```

This is separate from workflow-stage `runtime:` fields.

## Starter Catalog

The starter catalog is useful for provisioning demos:

```bash
malaclaw starter list
malaclaw starter suggest "research workflow"
malaclaw starter init default-managed ./my-project
```

Starter projects usually focus on teams/packs. They may or may not include a
`workflow:` block.

## OpenClaw Adapter

OpenClaw remains supported:

- `malaclaw install` can patch `~/.openclaw/openclaw.json`,
- `skills/malaclaw-cook/` can guide an OpenClaw-first user,
- native OpenClaw agents and skills can be discovered and attached.

This is an adapter path, not the only way to use MalaClaw.

## Dashboard

```bash
malaclaw dashboard
```

The dashboard reads project manifests, lockfiles, telemetry, and starter
metadata. It is useful for inspecting provisioned projects and active flow
runs. The LongWrite tab reads a writing workspace, summarizes `longwrite.yaml`,
the compiled `malaclaw.yaml`, runtime/model policy, review cadence, flow status,
token/cost telemetry, command hints, recent worker logs, and dashboard-launched
run output. It can start one LongWrite run per workspace, reject duplicate
runs, edit the stable `longwrite.yaml` project/research/review fields through
LongWrite's config validator, approve pending LongWrite gates, and generate
`reports/human-review-packet.md`, then links into the Flow monitor for deeper
logs and events. Workflow structure and mode recompilation still stay in the
LongWrite CLI/YAML path.
