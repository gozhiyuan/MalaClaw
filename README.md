# openclaw-store

**Ready-made multi-agent teams for OpenClaw.** Install a full dev company, content studio, or research lab in one command — then customize every agent, team, and skill to match your workflow.

---

## Why this exists

OpenClaw is powerful but has a steep setup curve: configuring agents, wiring up shared memory, preventing race conditions, and setting up team coordination all require deep ecosystem knowledge.

`openclaw-store` closes that gap with **starter packs** — pre-built, production-ready multi-agent teams you install like npm packages.

---

## Quick Start

Need the end-to-end usage flow for this repo? See [docs/repo-workflow.md](./docs/repo-workflow.md).

### 1. Install the CLI

```bash
# In this repo:
npm install
npm run build
npm link   # makes `openclaw-store` available globally
```

### 2. Initialise a project

```bash
mkdir my-project && cd my-project
openclaw-store init
```

The interactive wizard asks which packs and skills you want:

```
openclaw-store init

◆ Select starter packs to install:
│  ◼ Dev Company — Full software development team: PM, Tech Lead, Backend...
│  ◻ Content Factory — Content production team: Editor, Writer, SEO...
│  ◻ Research Lab — Research team: Research Lead, Data Analyst...
│  ◻ Autonomous Startup — Single-agent CEO generalist...
└

◆ Add optional skills (can be added later):
│  ◼ GitHub  [curated]
│  ◻ Last 30 Days Research  [requires: OPENAI_API_KEY]
└

Created openclaw-store.yaml with 1 pack(s) and 1 skill(s).
Run: openclaw-store install --dry-run   to preview
Run: openclaw-store install             to install
```

### 3. Preview the install

```bash
openclaw-store install --dry-run
```

Shows every file that will be created and every config change before touching anything.

### 4. Install

```bash
openclaw-store install
```

This:
- Creates agent workspaces at `~/.openclaw-store/workspaces/store/<project>/<team>/<agent>/`
- Writes 5 bootstrap files per agent (SOUL.md, IDENTITY.md, TOOLS.md, AGENTS.md, USER.md)
- Seeds shared memory files with ownership headers
- Patches `~/.openclaw/openclaw.json` with the new agents
- Registers the project in `~/.openclaw-store/runtime.json`
- Updates your main agent's TOOLS.md and AGENTS.md with store guidance
- Writes `openclaw-store.lock`

### 5. Verify

```bash
openclaw-store doctor
# ✓ openclaw-store.yaml found
# ✓ openclaw.json found at ~/.openclaw/openclaw.json
# ✓ Lockfile found: 1 pack(s), 1 skill(s)
# ✓ Workspace OK: store__my-project__dev-company__pm
# ✓ Workspace OK: store__my-project__dev-company__tech-lead
# ...
# ✓ All checks passed.
```

---

## Available Packs

### Dev Company (`dev-company`)

Full software development team. Entry point: **Project Manager**.

```
📋 Project Manager (lead, entry point)
  🏗️ Tech Lead (lead)
    ⚙️ Backend Developer (specialist)
    🎨 Frontend Developer (specialist)
    🧪 QA Engineer (reviewer)
    🛡️ Security Engineer (reviewer)
  🚀 DevOps Engineer (specialist)
```

**Shared memory:**
| File | Access | Writer |
|---|---|---|
| `kanban.md` | single-writer | PM only |
| `team-shared.md` | single-writer | PM only |
| `tasks-log.md` | append-only | all |
| `blockers.md` | append-only | all |

**Invoke:** Open the `store__<project-id>__dev-company__pm` agent in OpenClaw and give it a task.

---

### Content Factory (`content-factory`)

Content production pipeline. Entry point: **Editor**.

```
✍️ Editor (lead, entry point)
  📝 Content Writer (specialist)
  🔍 SEO Specialist (specialist)
  📱 Social Media Manager (specialist)
  🎬 Video Producer (specialist)
```

**Shared memory:**
| File | Access | Writer |
|---|---|---|
| `content-brief.md` | single-writer | Editor only |
| `pipeline-log.md` | append-only | all |

---

### Research Lab (`research-lab`)

Rigorous research pipeline. Entry point: **Research Lead**.

```
🔬 Research Lead (lead, entry point)
  📊 Data Analyst (specialist)
  🧭 Researcher (specialist)
  📑 Report Writer (specialist)
```

**Shared memory:**
| File | Access | Writer |
|---|---|---|
| `research-brief.md` | single-writer | Lead only |
| `findings-log.md` | append-only | all |

---

### Autonomous Startup (`autonomous-startup`)

Single CEO agent that spawns sub-agents as needed. Entry point: **CEO**.

```
🦅 CEO (lead, entry point)
```

Good for: open-ended tasks, solo agent with on-demand specialisation.

---

## CLI Reference

```bash
# Setup
openclaw-store init                          # Interactive wizard
openclaw-store install [--dry-run] [--force] [--no-openclaw] # Install from openclaw-store.yaml
openclaw-store install --pack dev-company    # One-shot install (no manifest needed)
openclaw-store uninstall --pack dev-company  # Remove a pack
openclaw-store uninstall --all               # Remove everything

# Exploration
openclaw-store list                          # List all packs, teams, agents, skills
openclaw-store list --packs                  # Packs only
openclaw-store list --agents                 # Agent templates only
openclaw-store list --teams                  # Team templates only
openclaw-store list --skills                 # Skills with activation status

openclaw-store agent show <id>               # Agent details + capability matrix
openclaw-store agent refresh <id>            # Re-render workspace from YAML template
openclaw-store team show <id>                # Team graph + shared memory config

openclaw-store skill show <id>               # Skill details + env var status
openclaw-store skill check                   # Check which skills are active/inactive

openclaw-store project list                  # List installed projects from runtime.json
openclaw-store project show <id>             # Show one installed project's entry points
openclaw-store project status                # Installation overview
openclaw-store project kanban <team-id>      # Show team kanban board

# Preview & validate
openclaw-store diff                          # Show what would change vs lockfile
openclaw-store validate                      # Validate all templates against schema

# CI / Claude Code mode
openclaw-store install --no-openclaw         # Install without patching openclaw.json

# Health
openclaw-store doctor                        # Full health check
openclaw-store doctor --fix                  # Attempt auto-remediation
```

---

## Project Layer

`openclaw-store` is now project-scoped, not just team-scoped.

- Each project has its own `openclaw-store.yaml` and `openclaw-store.lock`
- Each install gets a `project.id`
- Installed agent IDs are namespaced as `store__<project>__<team>__<agent>`
- Installed workspaces live under `~/.openclaw-store/workspaces/store/<project>/<team>/<agent>/`
- `~/.openclaw-store/runtime.json` is the global registry of installed projects

The project manifest is the control point for choosing which teams and skills a project should run:

```yaml
version: 1
project:
  id: podcast-studio
  name: "Podcast Studio"
  entry_team: content-factory
packs:
  - id: content-factory
  - id: research-lab
skills:
  - id: github
  - id: last30days
    env:
      OPENAI_API_KEY: required
  - id: openclaw-store-manager
    targets:
      agents:
        - tech-lead
```

That means:

- OpenClaw agents for this project are installed under the `podcast-studio` namespace
- The project gets both the `content-factory` and `research-lab` teams
- `content-factory` is the preferred team to open first
- Any agent template that declares `github` or `last30days` receives those skills during install
- `openclaw-store-manager` is additionally targeted to `tech-lead` for this project

Skill placement rules:

- A project skill is installed into agents that declare it in their agent YAML
- You can also target a skill at install time with `targets.agents` or `targets.teams`
- OpenClaw does not auto-install missing skills on its own
- If you change skill placement, re-run `openclaw-store install`

To add another project later, create or enter that project's directory and run `openclaw-store init` there. Then use `openclaw-store project list` and `openclaw-store project show <id>` to discover installed projects and their entry-point agents.

---

## Customisation Guide

### Override an agent's model

In `openclaw-store.yaml`:

```yaml
version: 1
project:
  id: my-project
  name: "My Project"
packs:
  - id: dev-company
    overrides:
      pm.model.primary: "claude-sonnet-4-5"      # cheaper PM
      tech-lead.model.primary: "claude-opus-4-5"  # keep lead on opus
```

### Edit an agent's persona

Copy the agent YAML to a `local-agents/` directory and edit it:

```bash
cp templates/agents/pm.yaml local-agents/pm.yaml
# edit local-agents/pm.yaml
```

Then point the loader at your local templates:

```bash
OPENCLAW_STORE_TEMPLATES=./local-agents openclaw-store install
```

Or set it permanently in your shell profile. The loader checks `OPENCLAW_STORE_TEMPLATES` first for each agent/team/skill, falling back to the bundled templates.

### Add a skill

1. Add to `openclaw-store.yaml`:
```yaml
skills:
  - id: last30days
    env:
      OPENAI_API_KEY: required
    targets:
      teams:
        - research-lab
```

2. Set the env var:
```bash
export OPENAI_API_KEY=sk-...
```

3. Re-install:
```bash
openclaw-store install
```

Skills with missing required env vars are installed as **inactive** and reported by `openclaw-store doctor`.
Skills are not attached to every agent automatically. They are installed where the agent template or the project `targets` rules place them.

### Create a custom agent

Create `templates/agents/my-agent.yaml`:

```yaml
id: my-agent
version: 1
name: "My Custom Agent"

identity:
  emoji: "🎯"
  vibe: "Short description of what this agent does"

soul:
  persona: |
    You are {{agent.name}} on the {{team.name}} team.
    [Your persona here...]
  tone: "How this agent communicates"
  boundaries:
    - "What this agent never does"

model:
  primary: "claude-sonnet-4-5"

capabilities:
  coordination:
    sessions_spawn: false   # true for leads only
    sessions_send: false    # always false
  file_access:
    write: true
    edit: true
    apply_patch: true
  system:
    exec: true
    cron: false
    gateway: false

team_role:
  role: specialist  # lead | specialist | reviewer
```

Then reference it in a team YAML.

### Create a custom team

Create `templates/teams/my-team.yaml`:

```yaml
id: my-team
name: "My Team"
version: 1

members:
  - agent: my-lead-agent
    role: lead
    entry_point: true
  - agent: my-specialist
    role: specialist

graph:
  - from: my-lead-agent
    to: my-specialist
    relationship: delegates_to

shared_memory:
  dir: "~/.openclaw-store/workspaces/store/<project-id>/my-team/shared/memory/"
  files:
    - path: tasks-log.md
      access: append-only
      writer: "*"
    - path: brief.md
      access: single-writer
      writer: my-lead-agent
```

Then create a pack YAML in `packs/my-team.yaml`:

```yaml
id: my-team
version: "1.0.0"
name: "My Team"
description: "What this team does"
teams:
  - my-team
```

Install it:
```bash
openclaw-store install --pack my-team
```

### Add a custom skill

Create `templates/skills/my-skill.yaml`:

```yaml
id: my-skill
version: 1
name: "My Skill"
description: "What it does"

source:
  type: local              # local | clawhub | openclaw-bundled
  url: "path/to/skill"

trust_tier: local          # curated | community | local

requires:
  env:
    - key: MY_API_KEY
      description: "API key for my service"
      required: true

disabled_until_configured: true
```

To place a skill on specific agents without editing every bundled agent template, target it from the project manifest:

```yaml
skills:
  - id: my-skill
    targets:
      agents:
        - pm
        - tech-lead
```

---

## State Files

| File | Location | Committed? | Purpose |
|---|---|---|---|
| `openclaw-store.yaml` | project root | ✓ yes | Project ID plus which packs/skills should be installed |
| `openclaw-store.lock` | project root | ✓ yes | Resolved project, team, agent, and skill installation state |
| `~/.openclaw-store/runtime.json` | home | ✗ no | Global registry of installed projects and entry points |
| `~/.openclaw-store/` | home | ✗ no | Agent workspaces + shared memory + cache |
| `~/.openclaw/openclaw.json` | home | ✗ no | Patched by installer (agent list, allowlist) |

`openclaw-store.yaml` is created by `openclaw-store init`.

Example:

```yaml
version: 1
project:
  id: my-project
  name: "My Project"
packs:
  - id: dev-company
    overrides:
      pm.model.primary: "claude-sonnet-4-5"
skills:
  - id: github
  - id: last30days
    env:
      OPENAI_API_KEY: required
```

`openclaw-store.lock` is written by `openclaw-store install` when installing from the manifest. It is not written for `openclaw-store install --pack <id>` or `--dry-run`.

Example:

```yaml
version: 1
project:
  id: my-project
  name: "My Project"
packs:
  - type: pack
    id: my-project__dev-company__dev-company
    project_id: my-project
    source_id: dev-company
    team_id: dev-company
    version: 1.0.0
    agents:
      - id: store__my-project__dev-company__pm
        workspace: /Users/you/.openclaw-store/workspaces/store/my-project/dev-company/pm
        agent_dir: /Users/you/.openclaw/agents/store__my-project__dev-company__pm
      - id: store__my-project__dev-company__tech-lead
        workspace: /Users/you/.openclaw-store/workspaces/store/my-project/dev-company/tech-lead
        agent_dir: /Users/you/.openclaw/agents/store__my-project__dev-company__tech-lead
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

Typical lifecycle:

```bash
openclaw-store init     # creates openclaw-store.yaml
openclaw-store install  # reads yaml, installs teams, writes openclaw-store.lock
openclaw-store project list
openclaw-store project show my-project
```

---

## Development & Testing

```bash
npm test                    # Run all tests (vitest)
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
npm run build               # TypeScript compile
openclaw-store validate     # Validate all bundled templates
```

---

## Troubleshooting

**`openclaw.json not found`**
Either install OpenClaw first, or if you're running in CI/Claude Code without OpenClaw:
```bash
openclaw-store install --no-openclaw
```

**`[INACTIVE] last30days — missing: OPENAI_API_KEY`**
Set the env var and re-run `openclaw-store install`. Skills degrade gracefully when optional vars are missing.

**Agent workspace missing after reinstall**
Run `openclaw-store install --force` to overwrite existing workspace files.

**`openclaw-store doctor` shows errors**
Follow the `→` suggestions printed next to each error. Most are fixed with `openclaw-store install --force`.
