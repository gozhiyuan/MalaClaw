# MalaClaw

`malaclaw` is a runtime-agnostic project layer for multi-agent teams.

It helps you go from an idea, an existing prompt-and-skill workflow, or a starter demo to a managed project that can run on OpenClaw, Claude Code, Codex, or ClawTeam.

The bottleneck in multi-agent adoption is usually not raw model capability. It is turning scattered prompts, skills, and experiments into a repeatable project with the right entry point, team structure, runtime setup, and operator guidance.

## Why MalaClaw

- Start from natural language instead of forcing users to design YAML first.
- Move from ad hoc prompting to a reusable managed project without rebuilding from scratch.
- Keep the project model portable across multiple agent runtimes.
- Separate authoring from runtime provisioning, so one manifest can target different execution environments.
- Make team setup, skill targeting, and coordination rules inspectable instead of hidden in one-off prompts.

## Feature Highlights

| Area | What it gives you |
|---|---|
| Starter catalog | Curated demo projects that map real use cases to packs, teams, and required skills |
| Project bootstrap | Zero-config OpenClaw bootstrap or manifest-driven project install |
| Runtime adapters | One project model for OpenClaw, Claude Code, Codex, and ClawTeam |
| Team orchestration | Entry-point agents, reusable team graphs, and topology-aware coordination |
| Skill management | Project-targeted skill sync, install, allowlisting, and env requirement checks |
| Dashboard | Web UI for projects, agents, starter discovery, config review, and status checks |
| Telemetry | Normalized per-agent status files across supported runtimes |
| Validation | `diff`, `validate`, and `doctor` flows for safer installs and troubleshooting |

## Example Use Cases

- Podcast production pipelines with research, outlines, show notes, and promotion assets.
- Research workflows for earnings calls, market tracking, or technical news.
- Existing OpenClaw repos that need to be promoted into a structured multi-agent project.
- Personal assistant, automation, finance, customer-service, and data-ops setups.
- Runtime-portable teams you want to provision into OpenClaw today and ClawTeam or Codex later.

## Quick Start

### 1. Test the updated repo locally

From the repo root:

```bash
cd MalaClaw
npm install
npm run build
npm test
node dist/cli.js --help
```

If you want the CLI on your `PATH` while testing:

```bash
npm link
malaclaw --help
```

For a fuller local testing guide, including safe smoke tests and starter-based flows, see [docs/local-development.md](./docs/local-development.md).

### 2. Bootstrap from OpenClaw

If you are already using OpenClaw, the recommended entry point is to let OpenClaw follow the bundled manager skill:

```text
Please follow this SKILL.md to install malaclaw-cook for me and bootstrap malaclaw:

- local file: skills/malaclaw-cook/SKILL.md
- or repo URL: https://github.com/gozhiyuan/MalaClaw/blob/main/skills/malaclaw-cook/SKILL.md
```

Or use the CLI bootstrap directly:

```bash
malaclaw install
```

If there is no `malaclaw.yaml`, `malaclaw` does a zero-config bootstrap instead of failing. It installs the bundled `malaclaw-cook` skill into your main OpenClaw workspace and updates the main guidance files.

### 3. Try a starter project

```bash
malaclaw starter list
malaclaw starter suggest "podcast workflow"
malaclaw starter init podcast-production-pipeline ./my-podcast-project
cd ./my-podcast-project
malaclaw install
malaclaw doctor
```

### 4. Start from an existing repo

```bash
cd ./my-project
malaclaw init
malaclaw install --dry-run
malaclaw install
```

`malaclaw init` creates `malaclaw.yaml`, and `install` reconciles that manifest into runtime-specific workspaces.

## What MalaClaw Gives You

- Starter demos that map ideas to reusable project scaffolds.
- Reusable packs and team templates with clear entry-point agents.
- Skill targeting rules so the right agents get the right tools.
- Runtime adapters for OpenClaw, Claude Code, Codex, and ClawTeam.
- Topology-aware teams that can stay simple or scale into structured coordination.
- A built-in dashboard for inspecting projects, agents, starters, and config state.

## Supported Runtimes

Set `runtime:` in `malaclaw.yaml` to target the desired runtime.

| Runtime | Manifest value | Install result |
|---|---|---|
| OpenClaw | `openclaw` | Patches `~/.openclaw/openclaw.json` and creates agent workspace dirs |
| Claude Code | `claude-code` | Generates `CLAUDE.md` per agent workspace |
| Codex | `codex` | Generates `AGENTS.md` per agent workspace |
| ClawTeam | `clawteam` | Exports `team.toml` and a spawn catalog for native orchestration |

Example:

```yaml
version: 1
runtime: clawteam
packs:
  - id: dev-company
```

## Communication Topologies

Each team can declare or auto-infer a topology that controls how agents coordinate.

| Topology | Description | Runtime support |
|---|---|---|
| `star` | All tasks flow through the lead. Workers report only to the lead. | All runtimes |
| `lead-reviewer` | Tasks flow through the lead, with explicit reviewer handoffs. | OpenClaw, ClawTeam |
| `pipeline` | Work moves through staged agents in sequence. | ClawTeam only |
| `peer-mesh` | Agents can coordinate laterally through shared memory. | ClawTeam only |

If a topology is incompatible with the selected runtime, MalaClaw downgrades it to `star` with a warning. Use `malaclaw team show <id>` to inspect the resolved topology.

## OpenClaw Workflow

Once `malaclaw-cook` is installed, OpenClaw can guide three core paths:

1. Demo project flow: pick a starter, check required skills and APIs, initialize the project, then install it.
2. Promote-to-project flow: inspect an existing workflow, decide whether it should stay simple or become managed, then generate `malaclaw.yaml`.
3. Customize-managed-project flow: retarget skills, swap packs, attach native agents, and rerun validation/install commands.

That lets a user start with normal OpenClaw conversations and only adopt a managed project when the workflow is worth formalizing.

## Common OpenClaw Prompts

```text
Show me demo projects for podcast production.
I want to build a research workflow for earnings calls.
Help me turn this repo into a managed project.
Add a GitHub skill to this project.
Should this stay single-agent or become a team?
```

## Bundled Catalog

This repo currently includes:

- 9 reusable packs in [`packs/`](./packs)
- 37 starter demo projects in [`demo-projects/index.yaml`](./demo-projects/index.yaml)
- 28 bundled skill templates in [`templates/skills/`](./templates/skills)
- 1 bundled manager skill in [`skills/malaclaw-cook/`](./skills/malaclaw-cook)

Useful discovery commands:

```bash
malaclaw starter list
malaclaw starter show default-managed
malaclaw team show dev-company
malaclaw skill show malaclaw-cook
```

## Architecture

MalaClaw uses YAML as its authoring layer, then compiles that into runtime-specific workspace files.

High-level flow:

1. Load agents, teams, packs, starters, and skill metadata.
2. Resolve `malaclaw.yaml` into a concrete project plan.
3. Render runtime-specific prompts and workspace files.
4. Provision those files into the selected runtime.
5. Track agent state through normalized telemetry.

Mental model:

- OpenClaw, Codex, Claude Code, and ClawTeam are runtimes.
- MalaClaw is the project, install, and orchestration layer.
- `malaclaw.yaml` is the control plane.
- Rendered files such as `AGENTS.md`, `CLAUDE.md`, or `team.toml` are the runtime contract.

For the full architecture and renderer pipeline, see [docs/how-it-works.md](./docs/how-it-works.md).

## File Structure

```text
MalaClaw/
├── src/                   # CLI commands and core install logic
├── templates/
│   ├── agents/            # agent definitions
│   ├── teams/             # team graphs, topology, shared memory rules
│   └── skills/            # skill metadata
├── packs/                 # reusable bundles of teams and defaults
├── starters/              # starter project definitions
├── demo-projects/         # generated starter catalog and demo cards
├── skills/malaclaw-cook/  # manager skill used by OpenClaw bootstrap
├── dashboard/             # web dashboard
├── partials/              # shared prompt fragments
├── tests/                 # Vitest coverage for CLI and core libs
└── docs/                  # architecture, workflow, and setup guides
```

Important project state:

| File | Purpose |
|---|---|
| `malaclaw.yaml` | Desired project state: runtime, packs, skills, and project metadata |
| `malaclaw.lock` | Resolved install state |
| `demo-projects/index.yaml` | Starter catalog metadata |
| `skills/malaclaw-cook/SKILL.md` | OpenClaw-facing manager skill entry point |

## Skills and Runtime Boundary

Skills can exist in two places for two different reasons:

1. OpenClaw-owned installation: a skill is installed into OpenClaw so the runtime can use it.
2. Project-targeted materialization: MalaClaw discovers available skills and places them into the managed agent workspaces that need them.

So a user can install skills directly in OpenClaw first, then later let MalaClaw discover and target those skills inside a managed project.

## Telemetry

After install, MalaClaw tracks agent status through normalized files at `~/.malaclaw/agents/<agentId>/state.json`.

This lets the dashboard and status tooling read a runtime-agnostic status model even when the underlying data comes from different runtime observers.

## Useful Commands

```bash
# bootstrap and install
malaclaw install
malaclaw install --dry-run
malaclaw diff
malaclaw doctor
malaclaw dashboard

# starter catalog
malaclaw starter list
malaclaw starter suggest "<idea>"
malaclaw starter show <id>
malaclaw starter init <id> <dir>

# manifests, teams, agents, and skills
malaclaw init
malaclaw project list
malaclaw project show <id>
malaclaw team show <id>
malaclaw agent show <id>
malaclaw skill show <id>
malaclaw skill sync
malaclaw validate
```

## Documentation

- [docs/getting-started.md](./docs/getting-started.md): step-by-step demo setup, multi-runtime testing, dashboard verification, and customization
- [docs/local-development.md](./docs/local-development.md): how to build, test, and smoke-check the updated repo
- [docs/repo-workflow.md](./docs/repo-workflow.md): end-to-end repo usage and starter flows
- [docs/how-it-works.md](./docs/how-it-works.md): architecture, adapters, telemetry, and renderer model
- [docs/remote-access.md](./docs/remote-access.md): remote dashboard access options

## Reference Work

This repo builds on and is inspired by the surrounding OpenClaw ecosystem:

- [OpenClaw](https://github.com/openclaw/openclaw)
- [antfarm](https://github.com/snarktank/antfarm)
- [awesome-openclaw-usecases](https://github.com/hesamsheikh/awesome-openclaw-usecases)
- [awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills)
