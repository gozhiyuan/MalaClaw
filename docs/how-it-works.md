# How malaclaw Works

This document explains the technical architecture: data flow, file formats, the renderer pipeline, the coordination model, and how to extend everything.

---

## Architecture Overview

## Current Capabilities

### Teams, Skills, and Interactive Install

| Feature | Description |
|---|---|
| 5 new teams | `personal-assistant`, `automation-ops`, `customer-service`, `finance-ops`, `data-ops` — 20 new agent templates |
| 25 new skill templates | Communication, calendar, health, research, data, infra, and finance skills in `templates/skills/` |
| Per-agent skill assignments | Existing teams (content-factory, research-lab, dev-company) now declare specific skills per agent |
| 37 demo starters | All curated starters re-mapped to purpose-built teams with per-agent skill assignments |
| Skills Setup cards | Each `demo-projects/cards/<id>.md` now includes a `## Skills Setup` section listing which skills are needed and how to install them |
| Manager skill project init | `malaclaw-cook` guides users through missing skills conversationally — detect, explain, guide |
| `requires.bins` field | Skill templates now declare required system binaries before `env:` under `requires:` |

### Web Dashboard

| Feature | Description |
|---|---|
| `dashboard` command | Start a Fastify + React web UI on port 3456 |
| Overview page | Project selector, agent list, skill table, health checks, kanban, virtual office, cost tracker, activity feed |
| Projects page | Expandable project list with team graphs and agent details |
| Starters page | Searchable starter grid with one-click project initialization |
| Config page | Manifest viewer, diff preview, and install trigger |
| WebSocket events | Real-time file change notifications via chokidar file watcher |
| Remote access | Cloudflare Tunnel, Tailscale, or SSH tunnel (see `docs/remote-access.md`) |

### Runtime Adapters and Telemetry

| Feature | Description |
|---|---|
| Runtime adapters | Install dispatches to runtime-specific provisioners: OpenClaw, Claude Code, Codex, ClawTeam |
| `runtime:` manifest field | Set target runtime in `malaclaw.yaml` — defaults to `openclaw` |
| Agent telemetry | Normalized `state.json` per agent at `~/.malaclaw/agents/<id>/state.json` |
| Two-path observer | OpenClaw Gateway WebSocket + ClawTeam native state reader |
| TTL-based auto-idle | Status auto-downgrades to `idle` after `ttlSeconds` with no update |
| `RuntimeStatusProvider` | Dashboard aggregates telemetry from all active runtime observers |

### Communication Topologies

| Feature | Description |
|---|---|
| 4 topology types | `star`, `lead-reviewer`, `pipeline`, `peer-mesh` |
| Topology inference | Auto-detected from team graph structure (hub-spoke → star, cycles → peer-mesh, chains → pipeline) |
| Runtime validation | Validates topology compatibility with target runtime; auto-downgrades when incompatible |
| Role-specific guidance | Each agent's AGENTS.md includes topology-aware coordination rules |
| `team show` display | `malaclaw team show <id>` shows resolved topology with description |
| Enforcement modes | `advisory` (default) or `strict` enforcement of topology rules |

### Core Foundations

| Feature | Description |
|---|---|
| `diff` command | Preview what `install` would change vs the current lockfile |
| `validate` command | Validate all bundled templates against Zod schemas |
| `--no-openclaw` flag | Install without patching `openclaw.json` (CI, Claude Code) |
| Local overlay | Override any bundled template via `MALACLAW_TEMPLATES` |
| Multi-team packs | A single pack YAML can reference multiple teams |
| Starter demo projects | Use curated starter definitions to scaffold a managed project from a demo use case |
| Demo project catalog | Generated `demo-projects/index.yaml` and per-demo cards provide richer execution/setup guidance |
| Pack compatibility | `compatibility.node_min` / `openclaw_min` in pack YAML, checked by `doctor` |
| Skill installation | Skills are cached at `~/.malaclaw/cache/skills/` and symlinked per workspace |
| Test suite | Vitest tests covering schema, renderer, resolver, overlay, compat, skill-fetch, starters, telemetry, adapters, topology, and workflow detection |

---

```
┌─────────────────────────────────────────────────────────────┐
│                     malaclaw                          │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  Templates   │   │     CLI      │   │ Packs/Starters │  │
│  │  agents/     │   │  cli.ts      │   │  dev-company   │  │
│  │  teams/      │──▶│  commands/   │◀──│  content-fctry │  │
│  │  skills/     │   │  install.ts  │   │  research-lab  │  │
│  └──────────────┘   └──────┬───────┘   │  personal-asst │  │
│                             │          │  automation-ops│  │
│                     ┌───────┤          │  customer-svc  │  │
│                     │       │          │  finance-ops   │  │
│  ┌──────────────────▼──┐    │          │  data-ops      │  │
│  │    Dashboard        │    │          │  37 demos      │  │
│  │  Fastify + React    │    │          └────────────────┘  │
│  │  REST + WebSocket   │    │                               │
│  │  File watcher       │    │                               │
│  └──────────┬──────────┘   │                                │
│             │               │                                │
│              ┌─────────────▼──────────────┐                │
│              │         Core Lib           │                │
│              │  schema.ts  (Zod types)    │                │
│              │  loader.ts  (YAML → types) │                │
│              │  resolver.ts (manifest →   │                │
│              │              lock plan)    │                │
│              │  renderer.ts (YAML →       │                │
│              │              Markdown)     │                │
│              │  memory.ts  (seed files)   │                │
│              └─────────────┬──────────────┘                │
│                            │                               │
│              ┌─────────────▼──────────────┐               │
│              │         Adapters           │               │
│              │  registry.ts (dispatch)    │               │
│              │  openclaw.ts (provision +  │               │
│              │              observe)      │               │
│              │  claude-code.ts (CLAUDE.md)│               │
│              │  codex.ts (AGENTS.md)      │               │
│              │  clawteam.ts (team.toml +  │               │
│              │              observer)     │               │
│              └─────────────┬──────────────┘               │
│                            │                               │
│              ┌─────────────▼──────────────┐               │
│              │       Telemetry + Topology │               │
│              │  telemetry.ts (read/write  │               │
│              │    agent state.json)       │               │
│              │  topology.ts (infer,       │               │
│              │    validate, guidance)     │               │
│              └─────────────┬──────────────┘               │
└────────────────────────────┼────────────────────────────────┘
                             │
           ┌─────────────────▼──────────────────┐
           │         File System                │
           │                                    │
           │  ~/.malaclaw/                │  ← runtime
           │    runtime.json                    │
           │    agents/<id>/state.json          │  ← telemetry
           │    workspaces/store/<project>/<team>/<agent>/│
           │      SOUL.md                       │
           │      IDENTITY.md                   │
           │      TOOLS.md                      │
           │      AGENTS.md                     │
           │      USER.md                       │
           │    shared/memory/                  │
           │      kanban.md                     │
           │      tasks-log.md                  │
           │      ...                           │
           │                                    │
           │  ~/.openclaw/openclaw.json  ◀─patch │  ← OpenClaw
           │  ~/.openclaw/workspace/     ◀─patch │    config
           │    TOOLS.md                        │
           │    AGENTS.md                       │
           │                                    │
           │  ~/.clawteam/teams/*/       ◀─read │  ← ClawTeam
           │    config.json, spawn_registry.json│    (observer)
           │                                    │
           │  ./malaclaw.yaml             │  ← project
           │  ./malaclaw.lock             │    (committed)
           └────────────────────────────────────┘
```

---

## Data Flow: `malaclaw install`

Projects can be created in two ways:

- from scratch with `malaclaw init`
- from a curated starter with `malaclaw starter init <starter-id> <dir>`

There is also a zero-config bootstrap path:

- `malaclaw install` with no manifest installs `malaclaw-cook` into the main OpenClaw workspace instead of failing
- this lets the user begin from OpenClaw first, then create a managed project later

The starter path writes a project-local `malaclaw.yaml` that already includes:

- `project.starter`
- `project.entry_team`
- starter-selected packs
- project skills such as `malaclaw-cook`
- a copied `DEMO_PROJECT.md` card with setup and execution guidance

```
malaclaw.yaml
       │
       ▼
  loadManifest()
  ┌────────────────────┐
  │ version: 1         │
  │ project:           │
  │   id: my-project   │
  │ packs:             │
  │   - id: dev-company│
  │ skills:            │
  │   - id: last30days │
  └────────────────────┘
       │
       ▼
  resolveManifest()
  ┌─────────────────────────────────────────────────────┐
  │ For each pack:                                      │
  │   loadPack("dev-company") → PackDef                 │
  │     .teams: ["dev-company"]                         │
  │   loadTeam("dev-company") → TeamDef                 │
  │     .members: [pm, tech-lead, backend-dev, ...]     │
  │   For each member:                                  │
  │     loadAgent("pm") → AgentDef                      │
  │     resolveAgentId("my-project", "dev-company",     │
  │                    "pm")                            │
  │       → "store__my-project__dev-company__pm"        │
  │     resolveAgentWorkspaceDir("my-project",          │
  │                              "dev-company", "pm")   │
  │       → "~/.malaclaw/workspaces/store/        │
  │             my-project/dev-company/pm"              │
  │                                                     │
  │ For each skill:                                     │
  │   loadSkill("last30days") → SkillEntry              │
  │   checkSkillEnv() → { status: "inactive",           │
  │                       missingEnv: ["OPENAI_API_KEY"]}│
  └──────────────────────────────┬──────────────────────┘
                                 │ ResolveResult
                                 ▼
  getProvisioner(manifest.runtime)
  ┌─────────────────────────────────────────────────────┐
  │ Dispatch to runtime-specific provisioner:            │
  │   openclaw  → patch openclaw.json, create agent dirs│
  │   claude-code → generate CLAUDE.md per workspace    │
  │   codex     → generate AGENTS.md per workspace      │
  │   clawteam  → export team.toml + spawn catalog      │
  └──────────────────────────────┬──────────────────────┘
                                 │
                                 ▼
  installTeam() per pack
  ┌─────────────────────────────────────────────────────┐
  │ provisionAgent() for each agent:                    │
  │   renderBootstrapFiles(agentDef, teamDef, member)   │
  │     → { "SOUL.md": "...", "TOOLS.md": "...", ... }  │
  │   Write files to workspaceDir                       │
  │   writeAgentTelemetry() → state.json (initial idle) │
  │                                                     │
  │ Runtime-specific post-provision:                    │
  │   openclaw: upsertAgentEntries + addToAllowlist     │
  │   clawteam: write team.toml + spawn-catalog.json    │
  │   claude-code/codex: aggregate into single prompt   │
  └──────────────────────────────┬──────────────────────┘
                                 │
                                 ▼
  seedTeamSharedMemory(teamDef)
  ┌────────────────────────────────────────────────┐
  │ For each shared file:                          │
  │   Write ownership header                       │
  │   Write initial structure                      │
  │   (idempotent — never overwrites existing)     │
  └────────────────────────────────────────────────┘
                                 │
                                 ▼
  updateStoreGuidance()
  ┌────────────────────────────────────────────────┐
  │ Upsert <!-- malaclaw --> block into:     │
  │   ~/.openclaw/workspace/TOOLS.md               │
  │   ~/.openclaw/workspace/AGENTS.md              │
  └────────────────────────────────────────────────┘
                                 │
                                 ▼
  writeLockfile(lockfile)
  └── malaclaw.lock
```

---

## Data Flow: `malaclaw install` with no manifest

```
no malaclaw.yaml
         │
         ▼
  runInstall()
         │
         ▼
  detect missing manifest
         │
         ▼
  runZeroConfigInstall()
  ┌─────────────────────────────────────────────────────┐
  │ loadSkill("malaclaw-cook")                │
  │ install into ~/.openclaw/workspace/skills/         │
  │ updateStoreGuidance()                              │
  │ print starter/bootstrap instructions               │
  └─────────────────────────────────────────────────────┘
         │
         ▼
  OpenClaw-first bootstrap complete
         │
         ▼
  user chooses starter or scratch managed path later
```

---

## Data Flow: `malaclaw starter init`

```
awesome-openclaw-usecases/*.md
         │
         ▼
  curated starter YAML
  ┌─────────────────────────────────────────────────────┐
  │ id: podcast-production-pipeline                     │
  │ entry_team: content-factory                         │
  │ packs: [content-factory]                            │
  │ project_skills: [malaclaw-cook]            │
  │ installable_skills: [youtube-research]              │
  │ required_apis: [YouTube API]                        │
  │ source_usecase: Podcast Production Pipeline         │
  └─────────────────────────────────────────────────────┘
         │
         ▼
  starter init <id> <dir>
         │
         ▼
  mkdir -p <dir>
         │
         ▼
  write project files
  ┌─────────────────────────────────────────────────────┐
  │ ./malaclaw.yaml                              │
  │   project:                                         │
  │     id: my-project                                 │
  │     starter: podcast-production-pipeline           │
  │     entry_team: content-factory                    │
  │   packs:                                           │
  │     - id: content-factory                          │
  │   skills:                                          │
  │     - id: malaclaw-cook                   │
  │       targets:                                     │
  │         teams: [content-factory]                   │
  │                                                    │
  │ ./STARTER.md                                       │
  │   source use case, bootstrap prompt, next steps    │
  │ ./DEMO_PROJECT.md                                  │
  │   richer execution modes, setup guidance, reqs     │
  └─────────────────────────────────────────────────────┘
         │
         ▼
  malaclaw install
         │
         ▼
  managed project install flow
```

The `starter suggest` command uses simple token overlap across starter metadata, packs, tags, and requirements. It is intentionally lightweight so the bundled `malaclaw-cook` skill can use it locally without external services.

The richer demo metadata is generated separately into `demo-projects/index.yaml` and `demo-projects/cards/*.md`. The manager skill uses those cards to decide whether to keep the user in default workflow mode or move them into a managed starter install.

---

## The Renderer Pipeline

The renderer is the heart of the system. It turns YAML agent definitions into the Markdown files that OpenClaw reads as agent context.

This boundary matters:

- YAML is the `malaclaw` authoring format
- rendered Markdown files are the OpenClaw runtime format

OpenClaw does not need to understand the team/pack/starter YAML files directly. `malaclaw` is the layer that validates, resolves, and compiles them into OpenClaw-ready workspaces.

```
AgentDef (YAML)         TeamDef (YAML)
┌─────────────────┐     ┌──────────────────┐
│ id: tech-lead   │     │ id: dev-company   │
│ name: Tech Lead │     │ name: Dev Company │
│ soul:           │     │ members: [...]    │
│   persona: |    │     │ graph: [...]      │
│     You are     │     │ shared_memory:    │
│     {{agent.name}}│   │   files: [...]    │
│     on the      │     └──────────────────┘
│     {{team.name}}│
│     team...     │
│ capabilities:   │
│   coordination: │
│     sessions_   │
│     spawn: true │
└────────┬────────┘
         │
         ▼
  substitute(template, context)
  context = {
    agent: { id, name, ... },
    team:  { id, name }
  }
  "{{agent.name}}" → "Tech Lead"
  "{{team.name}}"  → "Dev Company"
         │
         ▼
  renderBootstrapFiles()
  ┌────────────────────────────────────────────────────────┐
  │                                                        │
  │  SOUL.md         ← soul.persona + soul.tone + bounds  │
  │  IDENTITY.md     ← identity.emoji + vibe + model      │
  │  TOOLS.md        ← capabilities as readable table     │
  │  AGENTS.md       ← team graph + topology rules +      │
  │                     memory ownership                   │
  │  USER.md         ← user-facing summary                │
  │                                                        │
  └────────────────────────────────────────────────────────┘
```

### Example: AGENTS.md for Tech Lead

The renderer builds a personal, accurate AGENTS.md for each agent. It includes topology-specific coordination rules and per-agent memory access rights:

```markdown
# Team: Dev Company

## Your Role
You are the **lead** — **Tech Lead**.
As a **lead**, you can spawn sub-agents (`sessions_spawn: true`).

## Communication Topology

This team uses **star** topology.

All tasks flow through the lead. Workers report only to the lead.

**Your coordination rules:**
- Assign tasks to your direct reports and track their progress.
- Aggregate results from workers before reporting up.
- Route cross-worker coordination through yourself.

## Team Members
- **Project Manager** (`pm`) — lead *(entry point)*
- **Tech Lead** (`tech-lead`) — lead ← **YOU**
- **Backend Developer** (`backend-dev`) — specialist
...

## Delegation
You delegate tasks to:
- **Backend Developer** (`backend-dev`)
- **Frontend Developer** (`frontend-dev`)

## Shared Memory

| File           | Access        | Writer | Your Access                       |
|----------------|---------------|--------|-----------------------------------|
| tasks-log.md   | append-only   | all    | **APPEND ONLY** (no overwrites)   |
| team-shared.md | single-writer | pm     | read only                         |
| kanban.md      | single-writer | pm     | read only                         |
| blockers.md    | append-only   | all    | **APPEND ONLY** (no overwrites)   |
```

The same team YAML produces different AGENTS.md for pm (showing it as the sole writer) vs tech-lead (showing read-only access to those files). Topology rules are also tailored per role — a lead sees delegation instructions while a specialist sees reporting instructions.

---

## The Agent ID Convention

All store-managed agents use a `store__<project>__<team>__<agent>` prefix:

```
store__my-project__dev-company__pm
store__my-project__dev-company__tech-lead
store__my-project__dev-company__backend-dev
```

This prefix lets the installer:
- Identify all store-managed agents during uninstall
- Avoid collisions with user-defined agents in `openclaw.json`
- Reuse the same team template across multiple projects safely

---

## State Model: Project-Local + Runtime Cache

```
my-project/                        ← git-committed
├── malaclaw.yaml            ← WHAT to install
└── malaclaw.lock            ← WHAT was installed (resolved)

~/.malaclaw/                 ← NOT committed
├── runtime.json                  ← installed projects + entry points
├── agents/                       ← per-agent telemetry (all runtimes)
│   └── store__my-project__dev-company__pm/
│       └── state.json            ← normalized status, TTL, source
├── workspaces/
│   └── store/
│       └── my-project/
│           └── dev-company/
│               ├── pm/            ← agent workspace (bootstrap files)
│               ├── tech-lead/
│               ├── backend-dev/
│               └── shared/
│                   └── memory/    ← shared memory files
│                       ├── kanban.md
│                       ├── tasks-log.md
│                       └── ...
└── cache/
    ├── packs/                     ← future: downloaded remote packs
    └── skills/                    ← skill cache (symlinked per agent workspace)
        └── <skill-id>@<version>/

~/.openclaw/                       ← OpenClaw's own config (patched when runtime=openclaw)
├── openclaw.json                  ← agents.list + tools.agentToAgent
└── workspace/
    ├── TOOLS.md                   ← store guidance block injected
    └── AGENTS.md                  ← store guidance block injected

~/.clawteam/                       ← ClawTeam native state (read by observer)
└── teams/
    └── <team-name>/
        ├── config.json            ← team config
        ├── spawn_registry.json    ← process info
        └── tasks/
            └── task-*.json        ← task assignments
```

**Why project-local manifest + lockfile?**

Like `package.json` + `package-lock.json`: the manifest is what you *want*, the lockfile is what was actually *resolved*. The lockfile stores exact workspace paths, agent IDs, and skill status so that `malaclaw doctor` can verify the installation without re-resolving.

**Why runtime.json as well?**

The manifest and lockfile are local to one project directory. `runtime.json` is the global index that lets MalaClaw list all installed projects and their entry-point agents across your machine.
It also records any explicitly attached native OpenClaw agents so projects can reference them without mirroring the whole OpenClaw agent registry.

## Agent Ownership Model

`malaclaw` does not attempt to mirror every OpenClaw agent.

- **store-managed agents**: provisioned from packs/teams/starters by `malaclaw`
- **native OpenClaw agents**: already present in `openclaw.json`, discovered but not owned by the store
- **project-attached agents**: native OpenClaw agents explicitly attached to a managed project

This keeps ownership boundaries simple:

- OpenClaw remains the source of truth for all runtime agents
- `malaclaw` manages project/team scaffolding
- `install` is the reconciliation point that can place targeted skills into both store-managed agents and attached native agents

## Skill Availability Model

`malaclaw` does not mirror the full OpenClaw skill registry.

- **store-managed skill templates**: skills defined in `templates/skills/`
- **native OpenClaw skills**: skills already installed in `~/.openclaw/workspace/skills/` or `~/.openclaw/skills/`
- **store cache copies**: skills materialized in `~/.malaclaw/cache/skills/`

Use `malaclaw skill sync` to refresh the local availability inventory in `~/.malaclaw/skills-index.json`.
Discovered native skills can then be referenced directly by ID in `malaclaw.yaml`, and `install` becomes the reconciliation point that places them into targeted agent workspaces.

As with agents and teams, the YAML skill template is metadata for `malaclaw`. The runtime artifact OpenClaw actually uses is the installed skill directory inside the relevant workspace.

## Workflow Modes

`malaclaw` supports four practical modes:

1. Managed project mode
   The repo contains `malaclaw.yaml`, and `malaclaw` manages projects, teams, skills, lockfiles, and runtime registration. The `runtime:` field in the manifest determines which adapter is used.

2. Default Claude Code mode
   The repo contains `CLAUDE.md` or `.claude/`, but no `malaclaw.yaml`. In this case, `malaclaw` treats the repo as a normal Claude Code project and does not assume it is misconfigured.

3. Default OpenClaw mode
   OpenClaw is installed, but the repo does not have `malaclaw.yaml`. In this case, `malaclaw` treats the repo as a normal OpenClaw environment unless the user opts into managed projects.

4. Unconfigured mode
   None of the above. `malaclaw` offers to bootstrap.

This allows the `malaclaw-cook` skill to inspect default workflows first, then migrate a repo into managed mode only when the user asks for project/team/skill orchestration.

## Native Memory vs Shared Memory

`malaclaw` intentionally keeps two memory layers separate:

1. **Native OpenClaw memory**
   - lives inside each agent workspace
   - includes `MEMORY.md` and `memory/*.md`
   - is what OpenClaw memory tools operate on for that agent

2. **Shared team memory**
   - lives under `~/.malaclaw/workspaces/store/<project>/<team>/shared/memory/`
   - contains orchestration files such as `kanban.md`, `tasks-log.md`, and `blockers.md`
   - is managed by `malaclaw` ownership rules

This is deliberate. `malaclaw` orchestrates shared coordination state, but it does not replace or redefine OpenClaw's native memory layer.

---

## Interactive Project Initialization Flow

When a user asks the manager skill to start a demo project, the skill:

1. Runs `malaclaw starter suggest` to identify the best match
2. Reads `demo-projects/cards/<id>.md` for setup requirements
3. Detects which required skills or APIs are missing
4. Guides the user through configuring missing items conversationally
5. Calls `malaclaw starter init <id> <dir>` once prerequisites are met
6. Calls `malaclaw install` to provision the team

The skill uses a **declare-and-detect** pattern:

```
starter card declares requirements
         │
         ▼
manager reads cards/<id>.md
  project_skills   → placed automatically into malaclaw.yaml
  installable_skills → checked via `malaclaw skill sync`
  required_apis      → user must configure; manager guides setup
  required_capabilities → runtime prerequisites verified before init
         │
         ▼
missing required → block + guide user
missing optional → note + continue
all required met → call starter init + install
```

Required skills block project initialization. Optional skills are noted but do not block. The manager explains what each missing item is for before asking the user to act.

---

## Available Teams

The store ships 9 purpose-built teams across 9 packs:

| Team | Pack | Entry point | Focus |
|---|---|---|---|
| `dev-company` | dev-company | `pm` | Full software development |
| `content-factory` | content-factory | `editor` | Content, publishing, media |
| `research-lab` | research-lab | `research-lead` | Research, analysis, reports |
| `autonomous-startup` | autonomous-startup | varies | Full-stack autonomy |
| `personal-assistant` | personal-assistant | `personal-assistant-lead` | Life admin, calendar, health |
| `automation-ops` | automation-ops | `automation-lead` | Workflows, integrations, comms |
| `customer-service` | customer-service | `service-lead` | Multi-channel customer support |
| `finance-ops` | finance-ops | `finance-lead` | Markets, trading, risk |
| `data-ops` | data-ops | `data-lead` | ETL, analytics, storage |

---

## Communication Topologies

Teams can declare an explicit communication topology or have one inferred from their delegation graph.

### Topology Types

| Topology | Description | Auto-inferred when |
|---|---|---|
| **star** | All tasks flow through the lead. Workers report only to the lead. | Default; hub-spoke graph |
| **lead-reviewer** | Tasks flow through lead. Workers may request review from designated reviewers. | Graph has review edges from non-leads |
| **pipeline** | Tasks flow sequentially through stages. | Linear chain (all nodes out-degree ≤1) |
| **peer-mesh** | Agents may communicate with any other agent. | Graph has delegation cycles |

### Runtime Compatibility

| Topology | Claude Code | Codex | OpenClaw | ClawTeam |
|---|---|---|---|---|
| star | native | native | native | native |
| lead-reviewer | downgrade→star | downgrade→star | native | native |
| pipeline | downgrade→star | downgrade→star | downgrade→star | native |
| peer-mesh | downgrade→star | downgrade→star | downgrade→star | native |

When a topology is incompatible with the target runtime, it is automatically downgraded to **star** and a warning is emitted. Agents receive topology-specific coordination rules in their AGENTS.md, tailored to their role (lead, specialist, reviewer).

### Declaring Topology

Explicitly in team YAML:

```yaml
communication:
  topology: lead-reviewer
  enforcement: strict    # or "advisory" (default)
```

Or let `malaclaw` infer it from the team's `graph:` edges. Use `malaclaw team show <id>` to see the resolved topology.

---

## Coordination Model

```
                    User / Main Agent
                           │
                    sessions_spawn
                           │
                           ▼
              ┌────────────────────────┐
              │   Entry Point Agent    │ (e.g., PM)
              │   role: lead           │
              │   sessions_spawn: true │
              └────────────┬───────────┘
                           │ writes
                           ▼
                    ┌─────────────┐
                    │  kanban.md  │ (single-writer: PM)
                    │  team-shared│ (single-writer: PM)
                    └─────────────┘
                           │
             ┌─────────────┼─────────────┐
             │ sessions_spawn             │
             ▼                           ▼
    ┌─────────────────┐       ┌──────────────────┐
    │   Tech Lead     │       │  DevOps Engineer │
    │   role: lead    │       │  role: specialist│
    └────────┬────────┘       └──────────────────┘
             │                        │
             │ sessions_spawn         │ appends to
             ▼                        ▼
    ┌────────────────┐       ┌─────────────────┐
    │ Backend Dev    │       │  tasks-log.md   │ (append-only: all)
    │ Frontend Dev   │       │  blockers.md    │ (append-only: all)
    └────────────────┘       └─────────────────┘
             │
             │ appends to
             ▼
    ┌─────────────────┐
    │  tasks-log.md   │
    └─────────────────┘
```

**Key rules enforced by the template system:**

| Rule | How enforced |
|---|---|
| Leads can spawn sub-agents | `sessions_spawn: true` only in lead agent YAMLs |
| No direct peer messaging | `sessions_send: false` for ALL agents, embedded in TOOLS.md |
| No kanban race conditions | `single-writer: pm` in team YAML → only PM's AGENTS.md grants write access |
| Safe parallel writes | `append-only` pattern → specialists can write concurrently without conflicts |

---

## The Shared Memory Ownership Model

Every shared file has exactly one access pattern. No exceptions.

```
shared_memory:
  files:
    - path: kanban.md
      access: single-writer   ─────▶ ONLY pm writes. Others: read-only.
      writer: pm

    - path: tasks-log.md
      access: append-only     ─────▶ ANYONE can append. NO overwrites.
      writer: "*"

    - path: security-report.md
      access: private         ─────▶ ONLY security-engineer reads/writes.
      writer: security-engineer
```

The renderer translates each agent's access into concrete instructions in their AGENTS.md:
- PM sees: `kanban.md | WRITE (you are the sole writer)`
- Tech Lead sees: `kanban.md | read only`
- All agents see: `tasks-log.md | APPEND ONLY (no overwrites)`

---

## Tagged-Block Patching

The openclaw adapter injects guidance into the main agent's TOOLS.md and AGENTS.md using HTML comment markers:

```
<!-- malaclaw -->
# OpenClaw App Store
...guidance content...
<!-- /malaclaw -->
```

The `upsertBlock()` function is idempotent:
1. If the block exists → replace it in place
2. If not → append it

The `removeBlock()` function strips the block cleanly on uninstall. This pattern (from antfarm's `main-agent-guidance.ts`) ensures the file is always in a valid, parseable state even after multiple install/uninstall cycles.

---

## Customisation: Deep Dive

### Overriding agent templates

The loader searches `templates/agents/<id>.yaml` for agent definitions. To override an agent without modifying the bundled templates, you can create a local overlay by either:

1. Editing `templates/agents/<id>.yaml` directly (fine for personal forks)
2. Setting `MALACLAW_TEMPLATES` env var to point to a custom templates directory:
   ```bash
   MALACLAW_TEMPLATES=./my-templates malaclaw install
   ```
   The loader checks the overlay for each agent/team/skill YAML before falling back to bundled templates.

### The `{{variable}}` substitution system

The renderer uses a lightweight dot-notation substitution. Context available in all string fields:

```
{{agent.id}}           → "tech-lead"
{{agent.name}}         → "Tech Lead"
{{agent.model.primary}}→ "claude-opus-4-5"
{{team.id}}            → "dev-company"
{{team.name}}          → "Dev Company"
```

Substitution is applied to:
- `soul.persona`
- `soul.tone`
- `soul.boundaries[]`

This means one agent YAML can serve multiple teams with different names, and the generated Markdown always refers to the correct team.

### Adding a skill to an agent

1. Add the skill ID to the agent's `skills:` list in its YAML
2. Add the skill YAML to `templates/skills/<id>.yaml`
3. Add to `malaclaw.yaml` skills section
4. Run `malaclaw install`

The skill's env vars are checked at install time. If required vars are missing and `disabled_until_configured: true`, the skill is installed as **inactive** and reported by `doctor`.

You can also target a project skill without editing every agent template:

```yaml
skills:
  - id: malaclaw-cook
    targets:
      agents:
        - tech-lead
  - id: last30days
    targets:
      teams:
        - research-lab
```

Install behavior:

- If an agent template already lists the skill, it receives it
- If the project manifest targets a team or agent, those workspaces also receive it
- OpenClaw does not auto-install a missing skill by itself

### Defining a shared-service agent

An agent can appear in multiple teams. `security-engineer` is a reviewer in `dev-company` — you can also add it as an auditor in `content-factory`:

```yaml
# templates/teams/content-factory.yaml
members:
  - agent: editor
    role: lead
    entry_point: true
  ...
  - agent: security-engineer   # same YAML, different team context
    role: reviewer
```

When rendered, the security engineer's AGENTS.md will reference Content Factory as its team, but the same `security-engineer.yaml` definition is reused.

`malaclaw agent show security-engineer` reports all teams the agent belongs to.

---

## Schema Reference

### AgentDef (`templates/agents/*.yaml`)

```yaml
id: string                    # unique identifier (kebab-case)
version: number               # schema version
name: string                  # display name

identity:
  emoji: string               # single emoji
  vibe: string                # one-line personality description

soul:
  persona: string             # main persona text (supports {{variables}})
  tone: string                # communication style
  boundaries:                 # hard limits
    - string

model:
  primary: string             # claude-opus-4-5 | claude-sonnet-4-5 | claude-haiku-4-5
  fallback: string            # used when primary unavailable

capabilities:
  coordination:
    sessions_spawn: boolean   # can spawn sub-agents (leads only)
    sessions_send: boolean    # direct peer messaging (always false)
  file_access:
    write: boolean
    edit: boolean
    apply_patch: boolean
  system:
    exec: boolean
    cron: boolean             # schedule cron jobs (leads/orchestrators only)
    gateway: boolean

skills:
  - string                    # skill IDs from templates/skills/

memory:
  private_notes: string       # path to private notes file
  shared_reads:               # shared files this agent reads
    - string

team_role:
  role: lead | specialist | reviewer
  delegates_to:               # agent IDs this lead can delegate to
    - string
  reviews_for:                # agent IDs this reviewer serves
    - string
```

### TeamDef (`templates/teams/*.yaml`)

```yaml
id: string
name: string
version: number

communication:                  # optional — inferred from graph if omitted
  topology: star | lead-reviewer | pipeline | peer-mesh
  enforcement: advisory | strict  # default: advisory

members:
  - agent: string             # agent ID (references templates/agents/<id>.yaml)
    role: lead | specialist | reviewer
    entry_point: boolean      # exactly one per team

graph:
  - from: string              # agent ID
    to: string                # agent ID
    relationship: delegates_to | requests_review

shared_memory:
  dir: string                 # base directory for shared memory files
  files:
    - path: string            # filename relative to dir
      access: single-writer | append-only | private
      writer: string          # agent ID or "*" (for append-only)
```

### SkillEntry (`templates/skills/*.yaml`)

```yaml
id: string
version: number
name: string
description: string

source:
  type: clawhub | openclaw-bundled | local
  url: string
  pin: string                 # version pin

trust_tier: curated | community | local

requires:
  bins:                       # required system binaries (declare [] if none — must come BEFORE env:)
    - string
  env:
    - key: string             # env var name
      description: string
      required: boolean
      degradation: string     # what happens without it

disabled_until_configured: boolean
install_hints:
  - string                    # shown when skill is inactive
```

### PackDef (`packs/*.yaml`)

```yaml
id: string
version: string               # semver
name: string
description: string
teams:                        # team IDs to install
  - string
default_skills:               # auto-included skills
  - string
compatibility:                # optional version requirements
  openclaw_min: string        # minimum OpenClaw version (e.g. "2026.2.9")
  openclaw_max: string        # exclusive upper bound (optional)
  node_min: string            # minimum Node.js version (e.g. "22.0.0")
```

### Manifest (`malaclaw.yaml`)

Created by `malaclaw init`. This is the project's desired state: which packs and skills you want installed, and which runtime to target.

```yaml
version: 1
runtime: openclaw | claude-code | codex | clawteam  # default: openclaw
project:
  id: string                # project namespace used in agent IDs
  name: string
  description: string
  starter: string           # optional future starter/use-case source
  entry_team: string        # preferred team to open first
packs:
  - id: string
    version: string           # semver range (^1.0)
    overrides:                # key: "agent.field.path", value: override
      pm.model.primary: "claude-sonnet-4-5"
skills:
  - id: string
    env:                      # env requirement overrides
      KEY: required | optional
    targets:
      agents:
        - string
      teams:
        - string
```

Realistic example:

```yaml
version: 1
project:
  id: acme-web
  name: "Acme Web"
  entry_team: dev-company
packs:
  - id: dev-company
    overrides:
      pm.model.primary: "claude-sonnet-4-5"
  - id: research-lab
skills:
  - id: github
  - id: last30days
    env:
      OPENAI_API_KEY: required
    targets:
      teams:
        - research-lab
  - id: malaclaw-cook
    targets:
      agents:
        - tech-lead
```

### Lockfile (`malaclaw.lock`)

Generated by `malaclaw install` when installing from `malaclaw.yaml`. It is not written for `malaclaw install --pack <id>` or `malaclaw install --dry-run`.

This is the resolved state: exactly which teams, agents, workspaces, and skill states were installed. Do not edit it manually.

```yaml
version: 1
generated_at: string          # ISO timestamp
project:
  id: string
  name: string
  entry_team: string
  project_dir: string
packs:
  - type: pack
    id: string                # "<project>__<pack>__<team>"
    project_id: string
    version: string           # resolved version
    checksum: string          # sha256 of pack source
    agents:
      - id: string            # full agent ID (store__project__team__agent)
        workspace: string     # absolute path to workspace dir
        agent_dir: string     # absolute path to OpenClaw agent dir
skills:
  - type: skill
    id: string
    version: string
    status: active | inactive
    missing_env:              # populated when inactive
      - string
```

Realistic example:

```yaml
version: 1
project:
  id: acme-web
  name: "Acme Web"
  entry_team: dev-company
  project_dir: /Users/you/src/acme-web
packs:
  - type: pack
    id: acme-web__dev-company__dev-company
    project_id: acme-web
    source_id: dev-company
    team_id: dev-company
    version: <pack-version>
    agents:
      - id: store__acme-web__dev-company__pm
        workspace: /Users/you/.malaclaw/workspaces/store/acme-web/dev-company/pm
        agent_dir: /Users/you/.openclaw/agents/store__acme-web__dev-company__pm
      - id: store__acme-web__dev-company__tech-lead
        workspace: /Users/you/.malaclaw/workspaces/store/acme-web/dev-company/tech-lead
        agent_dir: /Users/you/.openclaw/agents/store__acme-web__dev-company__tech-lead
  - type: pack
    id: acme-web__research-lab__research-lab
    project_id: acme-web
    source_id: research-lab
    team_id: research-lab
    version: <pack-version>
    agents:
      - id: store__acme-web__research-lab__research-lead
        workspace: /Users/you/.malaclaw/workspaces/store/acme-web/research-lab/research-lead
        agent_dir: /Users/you/.openclaw/agents/store__acme-web__research-lab__research-lead
skills:
  - type: skill
    id: github
    version: "1"
    status: active
  - type: skill
    id: last30days
    version: "1"
    status: inactive
    missing_env:
      - OPENAI_API_KEY
```

Lifecycle summary:

```bash
malaclaw init          # creates malaclaw.yaml
malaclaw install       # reads yaml and writes malaclaw.lock
malaclaw project list  # global registry of installed projects
malaclaw install --pack dev-company  # one-shot install, no manifest or lockfile
malaclaw install --dry-run           # preview only, no lockfile write
```

---

## Runtime Adapter Architecture

`malaclaw` is a runtime-agnostic control plane. It provisions agents to different runtimes via adapters.

```
src/lib/adapters/
├── base.ts              ← RuntimeProvisioner + RuntimeObserver interfaces
├── registry.ts          ← getProvisioner(runtime) + getObserver(runtime)
├── openclaw.ts          ← OpenClaw adapter (provision + observe via Gateway WS)
├── claude-code.ts       ← Claude Code provisioner (generates CLAUDE.md)
├── codex.ts             ← Codex provisioner (generates AGENTS.md)
└── clawteam.ts          ← ClawTeam provisioner (team.toml) + observer (native state)
```

### Two-Path Observer Model

1. **OpenClaw direct:** Gateway WebSocket → writes to `~/.malaclaw/agents/<id>/state.json`
2. **ClawTeam-managed:** Reads `~/.clawteam/teams/*/` → writes to `~/.malaclaw/agents/<id>/state.json`

Both paths normalize to the same `AgentTelemetry` schema. The dashboard reads only the normalized files.

### Telemetry Schema

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

**Status values:** `idle`, `working`, `error`, `offline`
**Source values:** `gateway` (OpenClaw), `clawteam` (ClawTeam state), `heartbeat` (future), `manual` (install-time)

---

## Extension Points And Roadmap

| Feature | Where to add |
|---|---|
| Remote pack registry | `src/lib/resolver.ts` — add HTTP fetch before local lookup |
| Custom templates directory | ✅ Done — set `MALACLAW_TEMPLATES` env var |
| Runtime adapters | ✅ Done — OpenClaw, Claude Code, Codex, ClawTeam |
| Communication topologies | ✅ Done — star, lead-reviewer, pipeline, peer-mesh |
| Agent telemetry | ✅ Done — normalized state.json across all runtimes |
| Pack versioning + semver | `src/lib/resolver.ts` — extend `resolveManifest()` |
| `malaclaw update` | New command — re-resolve + diff lockfile |
| Dashboard UI | ✅ Done — `malaclaw dashboard` starts a Fastify + React web UI |
