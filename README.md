# openclaw-store

`openclaw-store` is a project layer on top of OpenClaw.

It gives OpenClaw a catalog of demo projects, starter manifests, reusable agent teams, and skill-targeting rules so a user can go from:

- "I have an idea"
- or "I already hacked together some skills and prompts"

to a repeatable managed project with the right entry-point agent, team structure, skills, and setup guidance.

Pain point: the bottleneck in OpenClaw adoption is usually not raw skill count. It is helping users discover repeatable ways OpenClaw can improve a real project, then turning those workflows into something structured and reusable.

## Get Started In OpenClaw

The recommended entry point is not "edit YAML first".

The recommended entry point is:

### Option 1: Let OpenClaw bootstrap from `SKILL.md` (recommended)

If you are already using OpenClaw, you should be able to hand it the manager skill directly.

Send OpenClaw something like:

```text
Please follow this SKILL.md to install openclaw-store-manager for me and bootstrap openclaw-store:

- local file: skills/openclaw-store-manager/SKILL.md
- or repo URL: <repo-url>/blob/main/skills/openclaw-store-manager/SKILL.md
```

The intended behavior is:

- OpenClaw reads the manager skill instructions
- installs or copies `openclaw-store-manager` into its workspace
- uses that skill to inspect demos, starters, packs, and skill requirements
- guides the user through any missing API auth or install steps
- promotes the repo into a managed project only when needed

### Option 2: Use the CLI bootstrap

If the CLI is already available on your machine, run:

```bash
openclaw-store install
```

If there is no `openclaw-store.yaml` in the current directory, `openclaw-store` does a zero-config bootstrap instead of failing:

- it installs the bundled `openclaw-store-manager` skill into your main OpenClaw workspace
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

## What `openclaw-store` Does Through OpenClaw

Once `openclaw-store-manager` is installed, OpenClaw can guide these flows.

### 1. Demo Project Flow

This is the catalog-driven path.

Typical sequence:

1. The user describes an idea.
2. `openclaw-store-manager` runs `starter suggest` and inspects the closest starter.
3. It reads the demo card metadata:
   - `entry_team`
   - `project_skills`
   - `installable_skills`
   - `required_apis`
   - `required_capabilities`
4. It asks the user for any missing auth or API setup.
5. It initializes the starter with `openclaw-store starter init`.
6. It customizes the generated `openclaw-store.yaml` if needed.
7. It runs `openclaw-store skill sync`, `openclaw-store install`, and `openclaw-store doctor`.
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
   - already `openclaw-store` managed
2. It looks at what the user is already doing:
   - recurring prompts
   - installed skills
   - external APIs
   - whether work needs one agent or a coordinated team
3. It recommends one of three outcomes:
   - stay in default workflow
   - promote to `default-managed`
   - promote to a fuller starter or custom managed project
4. It generates or edits `openclaw-store.yaml`.
5. It targets the needed skills to the right agents or teams.
6. It installs and verifies the project.

This is how a user can start with ad hoc OpenClaw skills and later turn them into a structured project without rebuilding from scratch.

### 3. Customize Managed Project Flow

After a project exists, OpenClaw can use `openclaw-store-manager` to:

- add or retarget skills
- swap packs or change the entry team
- attach native OpenClaw agents into a managed project
- install newly discovered OpenClaw skills into managed agent workspaces
- re-run `diff`, `install`, `doctor`, and `skill check`

## How Skills Work Across OpenClaw And `openclaw-store`

This is the key mental model:

- OpenClaw is the runtime.
- `openclaw-store` is the project and installation layer.

That means skills often exist in two places for two different reasons:

1. **OpenClaw-owned skill installation**
   - a skill is installed in OpenClaw's workspace/global skill locations
   - this is how the skill becomes available to OpenClaw itself

2. **Project-targeted skill materialization**
   - `openclaw-store skill sync` discovers available OpenClaw skills
   - `openclaw-store install` then symlinks or copies those skills into the managed agent workspaces that need them
   - it also updates OpenClaw agent allowlists when an agent has an explicit `skills[]` filter

So yes: a user can install their own skills directly in OpenClaw without going through `openclaw-store`, and later `openclaw-store` can discover those skills and attach them to a managed project.

The bundled `openclaw-store-manager` skill works the same way conceptually:

- zero-config bootstrap installs it into the main OpenClaw workspace
- starter or manifest targeting can also place it into managed project workspaces when desired

## Authoring Layer vs Runtime Layer

`openclaw-store` uses YAML as its authoring and orchestration format.

OpenClaw does not need to read the team or agent YAML files directly. Instead:

1. `openclaw-store` reads the YAML definitions for agents, teams, packs, starters, and skills
2. it renders the runtime Markdown files OpenClaw actually uses
3. it provisions those files into the agent workspaces that OpenClaw runs

In other words:

- YAML is the `openclaw-store` control plane
- rendered files like `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md`, `USER.md`, and `MEMORY.md` are the OpenClaw runtime contract

This is why the YAML structure is a good fit here: it is easy to validate, diff, generate from, and customize, while still compiling down to the exact OpenClaw workspace shape.

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
- 1 bundled manager skill implementation in [`skills/openclaw-store-manager/`](./skills/openclaw-store-manager)

Use these commands to explore the catalog:

```bash
openclaw-store starter list
openclaw-store starter suggest "podcast workflow"
openclaw-store starter show podcast-production-pipeline
openclaw-store team show dev-company
openclaw-store skill show openclaw-store-manager
```

## Optional Manual Installation

If you want to install the CLI locally from this repo:

```bash
git clone <this-repo>
cd openclaw-store
npm install
npm run build
npm link
```

Then bootstrap the OpenClaw entry path:

```bash
openclaw-store install
```

If you want to initialize a managed starter directly from the CLI:

```bash
openclaw-store starter suggest "habit tracker"
openclaw-store starter init habit-tracker-accountability-coach ./my-project
cd ./my-project
openclaw-store install
```

## Repository Structure

High-level layout:

```text
openclaw-store/
├── packs/                 # reusable pack definitions
├── templates/
│   ├── agents/            # agent YAML templates
│   ├── teams/             # team graphs + shared memory rules
│   └── skills/            # bundled skill metadata
├── starters/              # starter definitions for demo/project scaffolding
├── demo-projects/
│   ├── index.yaml         # generated demo catalog
│   └── cards/             # richer setup/execution cards per demo
├── skills/
│   └── openclaw-store-manager/
├── src/                   # CLI + install/runtime logic
└── docs/
```

Most important files:

- `openclaw-store.yaml`
  - project manifest, committed to the repo
- `openclaw-store.lock`
  - resolved install state, committed to the repo
- `demo-projects/index.yaml`
  - generated catalog for OpenClaw-guided demo selection
- `skills/openclaw-store-manager/SKILL.md`
  - the bridge skill that lets OpenClaw manage `openclaw-store` projects conversationally

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
| `openclaw-store.yaml` | desired project topology |
| `openclaw-store.lock` | resolved install state |
| `~/.openclaw-store/runtime.json` | installed project registry |
| `~/.openclaw-store/workspaces/store/...` | managed agent workspaces |
| `~/.openclaw/openclaw.json` | OpenClaw runtime config patched during install |

## Memory Boundary

`openclaw-store` does not replace OpenClaw's native memory model.

There are two distinct layers:

1. **OpenClaw native memory**
   - lives inside each agent workspace
   - includes `MEMORY.md` and `memory/*.md`
   - is what OpenClaw's memory tools index for that agent

2. **`openclaw-store` shared team memory**
   - lives under `~/.openclaw-store/workspaces/store/<project>/<team>/shared/memory/`
   - is used for coordination files like `kanban.md`, `tasks-log.md`, and `blockers.md`
   - is governed by explicit ownership rules from team YAML

The shared team memory layer is orchestration state, not a replacement for OpenClaw memory. Agents should continue to use OpenClaw's native memory layer for their own workspace memory, while `openclaw-store` manages the extra team coordination files around it.

## Useful Commands

```bash
# bootstrap
openclaw-store install
openclaw-store install --dry-run
openclaw-store install --force

# starter catalog
openclaw-store starter list
openclaw-store starter suggest "<idea>"
openclaw-store starter show <id>
openclaw-store starter init <id> <dir>

# projects
openclaw-store project list
openclaw-store project show <id>
openclaw-store project status

# teams / agents / skills
openclaw-store team show <id>
openclaw-store agent show <id>
openclaw-store skill show <id>
openclaw-store skill sync
openclaw-store skill check

# health
openclaw-store diff
openclaw-store validate
openclaw-store doctor
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
