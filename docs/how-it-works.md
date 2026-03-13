# How openclaw-store Works

This document explains the technical architecture: data flow, file formats, the renderer pipeline, the coordination model, and how to extend everything.

---

## Architecture Overview

## What's New in v1.0.0

| Feature | Description |
|---|---|
| `diff` command | Preview what `install` would change vs the current lockfile |
| `validate` command | Validate all bundled templates against Zod schemas |
| `--no-openclaw` flag | Install without patching `openclaw.json` (CI, Claude Code) |
| Local overlay | Override any bundled template via `OPENCLAW_STORE_TEMPLATES` |
| Multi-team packs | A single pack YAML can reference multiple teams |
| Pack compatibility | `compatibility.node_min` / `openclaw_min` in pack YAML, checked by `doctor` |
| Skill installation | Skills are cached at `~/.openclaw-store/cache/skills/` and symlinked per workspace |
| Test suite | 23 vitest tests covering schema, renderer, resolver, overlay, compat, skill-fetch, diff |

---

```
┌─────────────────────────────────────────────────────────────┐
│                     openclaw-store                          │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  Templates   │   │     CLI      │   │   Packs        │  │
│  │  agents/     │   │  cli.ts      │   │  dev-company   │  │
│  │  teams/      │──▶│  commands/   │◀──│  content-      │  │
│  │  skills/     │   │  install.ts  │   │  factory       │  │
│  └──────────────┘   └──────┬───────┘   └────────────────┘  │
│                            │                                │
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
│              │  openclaw.ts (full impl)   │               │
│              │  claude-code.ts (v2 stub)  │               │
│              └─────────────┬──────────────┘               │
└────────────────────────────┼────────────────────────────────┘
                             │
           ┌─────────────────▼──────────────────┐
           │         File System                │
           │                                    │
           │  ~/.openclaw-store/                │  ← runtime
           │    workspaces/store/<team>/<agent>/│
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
           │  ./openclaw-store.yaml             │  ← project
           │  ./openclaw-store.lock             │    (committed)
           └────────────────────────────────────┘
```

---

## Data Flow: `openclaw-store install`

```
openclaw-store.yaml
       │
       ▼
  loadManifest()
  ┌────────────────────┐
  │ version: 1         │
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
  │     resolveAgentId("dev-company", "pm")             │
  │       → "store__dev-company__pm"                    │
  │     resolveAgentWorkspaceDir("dev-company", "pm")   │
  │       → "~/.openclaw-store/workspaces/store/        │
  │             dev-company/pm"                         │
  │                                                     │
  │ For each skill:                                     │
  │   loadSkill("last30days") → SkillEntry              │
  │   checkSkillEnv() → { status: "inactive",           │
  │                       missingEnv: ["OPENAI_API_KEY"]}│
  └──────────────────────────────┬──────────────────────┘
                                 │ ResolveResult
                                 ▼
  installTeam() per pack
  ┌─────────────────────────────────────────────────────┐
  │ provisionAgent() for each agent:                    │
  │   renderBootstrapFiles(agentDef, teamDef, member)   │
  │     → { "SOUL.md": "...", "TOOLS.md": "...", ... }  │
  │   Write files to workspaceDir                       │
  │   mkdir agentDir (~/.openclaw/agents/store__*/agent)│
  │                                                     │
  │ upsertAgentEntries(config, entries)                 │
  │   Patch ~/.openclaw/openclaw.json agents.list       │
  │                                                     │
  │ addToAllowlist(config, leadAgentIds)                │
  │   Patch tools.agentToAgent.allow                    │
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
  │ Upsert <!-- openclaw-store --> block into:     │
  │   ~/.openclaw/workspace/TOOLS.md               │
  │   ~/.openclaw/workspace/AGENTS.md              │
  └────────────────────────────────────────────────┘
                                 │
                                 ▼
  writeLockfile(lockfile)
  └── openclaw-store.lock
```

---

## The Renderer Pipeline

The renderer is the heart of the system. It turns YAML agent definitions into the Markdown files that OpenClaw reads as agent context.

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
  │  AGENTS.md       ← team graph + memory ownership      │
  │  USER.md         ← user-facing summary                │
  │                                                        │
  └────────────────────────────────────────────────────────┘
```

### Example: AGENTS.md for Tech Lead

The renderer builds a personal, accurate AGENTS.md for each agent. The shared memory section shows each agent's *specific* access rights:

```markdown
# Team: Dev Company

## Your Role
You are the **lead** — **Tech Lead**.
As a **lead**, you can spawn sub-agents (`sessions_spawn: true`).

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

The same team YAML produces different AGENTS.md for pm (showing it as the sole writer) vs tech-lead (showing read-only access to those files).

---

## The Agent ID Convention

All store-managed agents use a `store__<team>__<agent>` prefix:

```
store__dev-company__pm
store__dev-company__tech-lead
store__dev-company__backend-dev
```

This prefix lets the installer:
- Identify all store-managed agents during uninstall
- Avoid collisions with user-defined agents in `openclaw.json`
- Filter agents by team for partial uninstalls

---

## State Model: Project-Local + Runtime Cache

```
my-project/                        ← git-committed
├── openclaw-store.yaml            ← WHAT to install
└── openclaw-store.lock            ← WHAT was installed (resolved)

~/.openclaw-store/                 ← NOT committed
├── workspaces/
│   └── store/
│       └── dev-company/
│           ├── pm/                ← agent workspace (5 Markdown files)
│           ├── tech-lead/
│           ├── backend-dev/
│           └── shared/
│               └── memory/        ← shared memory files
│                   ├── kanban.md
│                   ├── tasks-log.md
│                   └── ...
└── cache/
    ├── packs/                     ← future: downloaded remote packs
    └── skills/                    ← skill cache (symlinked per agent workspace)
        └── <skill-id>@<version>/

~/.openclaw/                       ← OpenClaw's own config (patched)
├── openclaw.json                  ← agents.list + tools.agentToAgent
└── workspace/
    ├── TOOLS.md                   ← store guidance block injected
    └── AGENTS.md                  ← store guidance block injected
```

**Why project-local manifest + lockfile?**

Like `package.json` + `package-lock.json`: the manifest is what you *want*, the lockfile is what was actually *resolved*. The lockfile stores exact workspace paths, agent IDs, and skill status so that `openclaw-store doctor` can verify the installation without re-resolving.

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
<!-- openclaw-store -->
# OpenClaw App Store
...guidance content...
<!-- /openclaw-store -->
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
2. Setting `OPENCLAW_STORE_TEMPLATES` env var to point to a custom templates directory:
   ```bash
   OPENCLAW_STORE_TEMPLATES=./my-templates openclaw-store install
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
3. Add to `openclaw-store.yaml` skills section
4. Run `openclaw-store install`

The skill's env vars are checked at install time. If required vars are missing and `disabled_until_configured: true`, the skill is installed as **inactive** and reported by `doctor`.

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

`openclaw-store agent show security-engineer` reports all teams the agent belongs to.

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
  bins:                       # required system binaries
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

### Manifest (`openclaw-store.yaml`)

```yaml
version: 1
packs:
  - id: string
    version: string           # semver range (^1.0)
    overrides:                # key: "agent.field.path", value: override
      pm.model.primary: "claude-sonnet-4-5"
skills:
  - id: string
    env:                      # env requirement overrides
      KEY: required | optional
```

### Lockfile (`openclaw-store.lock`)

Generated by `openclaw-store install`. Do not edit manually.

```yaml
version: 1
generated_at: string          # ISO timestamp
packs:
  - type: pack
    id: string
    version: string           # resolved version
    checksum: string          # sha256 of pack source
    agents:
      - id: string            # full agent ID (store__team__agent)
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

---

## Extension Points (v2 Roadmap)

| Feature | Where to add |
|---|---|
| Remote pack registry | `src/lib/resolver.ts` — add HTTP fetch before local lookup |
| Custom templates directory | ✅ Done — set `OPENCLAW_STORE_TEMPLATES` env var |
| Claude Code adapter | `src/lib/adapters/claude-code.ts` — already stubbed |
| Pack versioning + semver | `src/lib/resolver.ts` — extend `resolveManifest()` |
| `openclaw-store update` | New command — re-resolve + diff lockfile |
| Dashboard UI | `src/server/` — add a read-only web view over lockfile + memory files |
