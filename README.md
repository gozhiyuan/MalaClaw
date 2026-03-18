# malaclaw

`malaclaw` is a runtime-agnostic project layer for multi-agent teams.

It gives agent runtimes (OpenClaw, Claude Code, Codex, ClawTeam) a catalog of demo projects, starter manifests, reusable agent teams, and skill-targeting rules so a user can go from:

- "I have an idea"
- or "I already hacked together some skills and prompts"

to a repeatable managed project with the right entry-point agent, team structure, communication topology, skills, and setup guidance — on any supported runtime.

Pain point: the bottleneck in multi-agent adoption is usually not raw skill count. It is helping users discover repeatable ways agents can improve a real project, then turning those workflows into something structured, reusable, and runtime-portable.

## Get Started In OpenClaw

The recommended entry point is not "edit YAML first".

The recommended entry point is:

### Option 1: Let OpenClaw bootstrap from `SKILL.md` (recommended)

If you are already using OpenClaw, you should be able to hand it the manager skill directly.

Send OpenClaw something like:

```text
Please follow this SKILL.md to install malaclaw-cook for me and bootstrap malaclaw:

- local file: skills/malaclaw-cook/SKILL.md
- or repo URL: https://github.com/gozhiyuan/MalaClaw/blob/main/skills/malaclaw-cook/SKILL.md
```

The intended behavior is:

- OpenClaw reads the manager skill instructions
- installs or copies `malaclaw-cook` into its workspace
- uses that skill to inspect demos, starters, packs, and skill requirements
- guides the user through any missing API auth or install steps
- promotes the repo into a managed project only when needed

### Option 2: Use the CLI bootstrap

If the CLI is already available on your machine, run:

```bash
malaclaw install
```

If there is no `malaclaw.yaml` in the current directory, `malaclaw` does a zero-config bootstrap instead of failing:

- it installs the bundled `malaclaw-cook` skill into your main OpenClaw workspace
- it updates the main OpenClaw guidance files
- it leaves your repo in default OpenClaw mode until you choose to promote it

After that, start from a normal OpenClaw conversation.

### What To Ask In OpenClaw

Examples:

```text
Show me demo projects for podcast production.
I want to build a research workflow for earnings calls.
Help me turn this repo into a managed project.
Add a GitHub skill to this project.
Should this stay single-agent or become a team?
```

## Supported Runtimes

`malaclaw` provisions agents to different runtimes via an adapter registry. Set `runtime:` in `malaclaw.yaml` to target the desired runtime.

| Runtime | Manifest value | What happens on install |
|---|---|---|
| OpenClaw | `openclaw` (default) | Patches `~/.openclaw/openclaw.json`, creates agent workspace dirs |
| Claude Code | `claude-code` | Generates `CLAUDE.md` per agent workspace |
| Codex | `codex` | Generates `AGENTS.md` per agent workspace |
| ClawTeam | `clawteam` | Exports `team.toml` + spawn catalog for native ClawTeam orchestration |

Example:

```yaml
# malaclaw.yaml
version: 1
runtime: clawteam    # or openclaw (default), claude-code, codex
packs:
  - id: dev-company
```

## Communication Topologies

Each team can declare (or auto-infer) a communication topology that controls how agents coordinate:

| Topology | Description | Runtime support |
|---|---|---|
| **star** | All tasks flow through the lead. Workers report only to the lead. | All runtimes |
| **lead-reviewer** | Tasks flow through lead. Workers may request review from designated reviewers. | OpenClaw, ClawTeam |
| **pipeline** | Tasks flow sequentially through stages. Each agent passes to next stage. | ClawTeam only |
| **peer-mesh** | Agents may communicate with any other agent via shared memory. | ClawTeam only |

When a topology is incompatible with the target runtime, it is automatically downgraded to **star** with a warning. Topology rules are embedded in each agent's `AGENTS.md` as role-specific coordination instructions.

Use `malaclaw team show <id>` to see the resolved topology for any team.

## What `malaclaw` Does Through OpenClaw

Once `malaclaw-cook` is installed, OpenClaw can guide these flows.

### 1. Demo Project Flow

This is the catalog-driven path.

Typical sequence:

1. The user describes an idea.
2. `malaclaw-cook` runs `starter suggest` and inspects the closest starter.
3. It reads the demo card metadata:
   - `entry_team`
   - `project_skills`
   - `installable_skills`
   - `required_apis`
   - `required_capabilities`
4. It asks the user for any missing auth or API setup.
5. It initializes the starter with `malaclaw starter init`.
6. It customizes the generated `malaclaw.yaml` if needed.
7. It runs `malaclaw skill sync`, `malaclaw install`, and `malaclaw doctor`.
8. It tells the user which project entry-point agent to open in OpenClaw.

In practice, that means OpenClaw can help the user:

- choose a demo project
- create the managed project files
- install or target the right skills
- ask for missing API auth
- hand off to the correct agent team

### 2. Promote To Project Flow

This is the "I already have a workflow" path.

The intended promotion flow is:

1. OpenClaw inspects whether the repo is:
   - default OpenClaw workflow
   - default Claude Code workflow
   - already `malaclaw` managed
2. It looks at what the user is already doing:
   - recurring prompts
   - installed skills
   - external APIs
   - whether work needs one agent or a coordinated team
3. It recommends one of three outcomes:
   - stay in default workflow
   - promote to `default-managed`
   - promote to a fuller starter or custom managed project
4. It generates or edits `malaclaw.yaml`.
5. It targets the needed skills to the right agents or teams.
6. It installs and verifies the project.

This is how a user can start with ad hoc OpenClaw skills and later turn them into a structured project without rebuilding from scratch.

### 3. Customize Managed Project Flow

After a project exists, OpenClaw can use `malaclaw-cook` to:

- add or retarget skills
- swap packs or change the entry team
- attach native OpenClaw agents into a managed project
- install newly discovered OpenClaw skills into managed agent workspaces
- re-run `diff`, `install`, `doctor`, and `skill check`

## How Skills Work Across OpenClaw And `malaclaw`

This is the key mental model:

- OpenClaw is the runtime.
- `malaclaw` is the project and installation layer.

That means skills often exist in two places for two different reasons:

1. **OpenClaw-owned skill installation**
   - a skill is installed in OpenClaw's workspace/global skill locations
   - this is how the skill becomes available to OpenClaw itself

2. **Project-targeted skill materialization**
   - `malaclaw skill sync` discovers available OpenClaw skills
   - `malaclaw install` then symlinks or copies those skills into the managed agent workspaces that need them
   - it also updates OpenClaw agent allowlists when an agent has an explicit `skills[]` filter

So yes: a user can install their own skills directly in OpenClaw without going through `malaclaw`, and later `malaclaw` can discover those skills and attach them to a managed project.

The bundled `malaclaw-cook` skill works the same way conceptually:

- zero-config bootstrap installs it into the main OpenClaw workspace
- starter or manifest targeting can also place it into managed project workspaces when desired

## Authoring Layer vs Runtime Layer

`malaclaw` uses YAML as its authoring and orchestration format.

No runtime reads the team or agent YAML files directly. Instead:

1. `malaclaw` reads the YAML definitions for agents, teams, packs, starters, and skills
2. it renders runtime-specific files via the adapter registry
3. it provisions those files into the agent workspaces the target runtime uses

In other words:

- YAML is the `malaclaw` control plane
- the adapter registry dispatches to runtime-specific provisioners
- rendered files are the runtime contract:
  - **OpenClaw:** `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md`, `USER.md`, `MEMORY.md`
  - **Claude Code:** aggregated `CLAUDE.md` per agent workspace
  - **Codex:** `AGENTS.md` as primary prompt per agent workspace
  - **ClawTeam:** `team.toml` + `spawn-catalog.json` + per-agent prompt dirs

This is why the YAML structure is a good fit here: it is easy to validate, diff, generate from, and customize, while compiling down to the exact workspace shape each runtime expects.

## Agent Telemetry

After install, `malaclaw` tracks agent status across all runtimes via normalized telemetry files at `~/.malaclaw/agents/<agentId>/state.json`.

```json
{
  "agentId": "store__proj__team__pm",
  "runtime": "clawteam",
  "status": "working",
  "detail": "Research market trends",
  "updatedAt": "2026-03-17T18:20:00Z",
  "ttlSeconds": 300,
  "source": "clawteam"
}
```

Two observer paths feed telemetry:

1. **OpenClaw direct:** Gateway WebSocket → normalized telemetry files
2. **ClawTeam-managed:** Reads `~/.clawteam/` native state → normalized telemetry files

Both paths write the same schema. The dashboard reads only the normalized files, making it runtime-agnostic. After `ttlSeconds` with no update, status auto-downgrades to `idle`.

## Bundled Catalog In This Repo

This repo currently ships:

- 9 reusable packs:
  - `automation-ops`
  - `dev-company`
  - `personal-assistant`
  - `content-factory`
  - `customer-service`
  - `finance-ops`
  - `data-ops`
  - `research-lab`
  - `autonomous-startup`
- 37 starter demo projects in [`demo-projects/index.yaml`](./demo-projects/index.yaml)
- 28 bundled skill templates in [`templates/skills/`](./templates/skills)
- 1 bundled manager skill implementation in [`skills/malaclaw-cook/`](./skills/malaclaw-cook)

Use these commands to explore the catalog:

```bash
malaclaw starter list
malaclaw starter suggest "podcast workflow"
malaclaw starter show podcast-production-pipeline
malaclaw team show dev-company
malaclaw skill show malaclaw-cook
```

## Optional Manual Installation

If you want to install the CLI locally from this repo:

```bash
git clone <this-repo>
cd malaclaw
npm install
npm run build
npm link
```

Then bootstrap the OpenClaw entry path:

```bash
malaclaw install
```

If you want to initialize a managed starter directly from the CLI:

```bash
malaclaw starter suggest "habit tracker"
malaclaw starter init habit-tracker-accountability-coach ./my-project
cd ./my-project
malaclaw install
```

## Repository Structure

High-level layout:

```text
malaclaw/
├── packs/                 # reusable pack definitions
├── templates/
│   ├── agents/            # agent YAML templates
│   ├── teams/             # team graphs + topology + shared memory rules
│   └── skills/            # bundled skill metadata
├── starters/              # starter definitions for demo/project scaffolding
├── demo-projects/
│   ├── index.yaml         # generated demo catalog
│   └── cards/             # richer setup/execution cards per demo
├── skills/
│   └── malaclaw-cook/
├── partials/              # shared Markdown fragments for rendered bootstrap files
├── src/                   # CLI + install/runtime logic
│   └── lib/
│       ├── adapters/      # runtime adapters (openclaw, claude-code, codex, clawteam)
│       ├── telemetry.ts   # per-agent telemetry read/write
│       └── topology.ts    # topology inference, validation, guidance
├── dashboard/             # web dashboard (Fastify server + React SPA)
│   ├── server/            # Fastify routes, WebSocket, file watcher
│   └── src/               # React components, pages, hooks
└── docs/
```

Most important files:

- `malaclaw.yaml`
  - project manifest, committed to the repo
- `malaclaw.lock`
  - resolved install state, committed to the repo
- `demo-projects/index.yaml`
  - generated catalog for OpenClaw-guided demo selection
- `skills/malaclaw-cook/SKILL.md`
  - the bridge skill that lets OpenClaw manage `malaclaw` projects conversationally

## Technical Model

### Packs

Packs are reusable bundles of teams plus default skills.

Examples:

- [`packs/dev-company.yaml`](./packs/dev-company.yaml)
- [`packs/content-factory.yaml`](./packs/content-factory.yaml)
- [`packs/research-lab.yaml`](./packs/research-lab.yaml)
- [`packs/autonomous-startup.yaml`](./packs/autonomous-startup.yaml)

### Teams

Teams define:

- members
- lead/specialist/reviewer roles
- delegation graph
- communication topology (star, lead-reviewer, pipeline, peer-mesh)
- shared memory files

Examples live in:

- [`templates/teams/`](./templates/teams)

### Agents

Agents define:

- persona
- tone and boundaries
- primary/fallback model
- file/system/coordination capabilities
- the skills each agent expects

Examples live in:

- [`templates/agents/`](./templates/agents)

### Skills

Bundled skill templates define:

- source type
- trust tier
- required binaries
- required env vars
- install hints

Examples live in:

- [`templates/skills/`](./templates/skills)

### Starters

Starter definitions are the project scaffolding layer.

Each starter includes:

- source use case
- preferred `entry_team`
- `packs`
- `project_skills`
- `installable_skills`
- `required_apis`
- `required_capabilities`
- a bootstrap prompt

These files live in:

- [`starters/`](./starters)

### Demo Cards

Demo cards are richer, generated project guides used by the manager skill.

They live in:

- [`demo-projects/cards/`](./demo-projects/cards)

### Project State

Main state files:

| File | Purpose |
|---|---|
| `malaclaw.yaml` | desired project state (packs, skills, runtime target) |
| `malaclaw.lock` | resolved install state |
| `~/.malaclaw/runtime.json` | installed project registry |
| `~/.malaclaw/workspaces/store/...` | managed agent workspaces |
| `~/.malaclaw/agents/<id>/state.json` | per-agent telemetry (normalized across runtimes) |
| `~/.openclaw/openclaw.json` | OpenClaw runtime config (patched when `runtime: openclaw`) |

## Memory Boundary

`malaclaw` does not replace OpenClaw's native memory model.

There are two distinct layers:

1. **OpenClaw native memory**
   - lives inside each agent workspace
   - includes `MEMORY.md` and `memory/*.md`
   - is what OpenClaw's memory tools index for that agent

2. **`malaclaw` shared team memory**
   - lives under `~/.malaclaw/workspaces/store/<project>/<team>/shared/memory/`
   - is used for coordination files like `kanban.md`, `tasks-log.md`, and `blockers.md`
   - is governed by explicit ownership rules from team YAML

The shared team memory layer is orchestration state, not a replacement for OpenClaw memory. Agents should continue to use OpenClaw's native memory layer for their own workspace memory, while `malaclaw` manages the extra team coordination files around it.

## Web Dashboard

`malaclaw` includes a built-in web dashboard for visual management of projects, agents, teams, skills, and configuration.

```bash
malaclaw dashboard
```

Opens at http://localhost:3456 with:

- **Overview** — project selector, agent list, skill table, health checks, kanban board, virtual office, cost tracker, activity feed
- **Projects** — expandable project list with team graphs, kanban, and agent details
- **Starters** — searchable grid of starter cards with one-click init
- **Config** — manifest viewer, diff preview, and install trigger

The dashboard uses a Fastify server with WebSocket for real-time file change notifications. All data comes from the existing YAML/JSON files — no database.

Options:

```bash
malaclaw dashboard --port 8080    # custom port
malaclaw dashboard --host 127.0.0.1  # localhost only
```

For remote access (Cloudflare Tunnel, Tailscale, SSH), see [docs/remote-access.md](./docs/remote-access.md).

## Useful Commands

```bash
# bootstrap
malaclaw install
malaclaw install --dry-run
malaclaw install --force

# starter catalog
malaclaw starter list
malaclaw starter suggest "<idea>"
malaclaw starter show <id>
malaclaw starter init <id> <dir>

# projects
malaclaw project list
malaclaw project show <id>
malaclaw project status

# teams / agents / skills
malaclaw team show <id>
malaclaw agent show <id>
malaclaw skill show <id>
malaclaw skill sync
malaclaw skill check

# health + dashboard
malaclaw diff
malaclaw validate
malaclaw doctor
malaclaw dashboard
```

## More Detail

For the full architecture and install/runtime model:

- [docs/how-it-works.md](./docs/how-it-works.md)
- [docs/repo-workflow.md](./docs/repo-workflow.md)

## Reference Work

This repo builds on and is inspired by the surrounding OpenClaw ecosystem.

Thanks in particular to:

- [OpenClaw](https://github.com/openclaw/openclaw)
- [antfarm](https://github.com/snarktank/antfarm)
- [awesome-openclaw-usecases](https://github.com/hesamsheikh/awesome-openclaw-usecases)
- [awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills)

Those projects provide the runtime foundation, installer and guidance patterns, use-case catalog, and skill discovery surface that make this store model useful.
