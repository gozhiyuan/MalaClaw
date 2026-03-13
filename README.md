# openclaw-app-store

**Ready-made multi-agent teams for OpenClaw.** Install a full dev company, content studio, or research lab in one command — then customize every agent, team, and skill to match your workflow.

---

## Why this exists

OpenClaw is powerful but has a steep setup curve: configuring agents, wiring up shared memory, preventing race conditions, and setting up team coordination all require deep ecosystem knowledge.

`openclaw-app-store` closes that gap with **starter packs** — pre-built, production-ready multi-agent teams you install like npm packages.

---

## Quick Start

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
- Creates agent workspaces at `~/.openclaw-store/workspaces/store/<team>/<agent>/`
- Writes 5 bootstrap files per agent (SOUL.md, IDENTITY.md, TOOLS.md, AGENTS.md, USER.md)
- Seeds shared memory files with ownership headers
- Patches `~/.openclaw/openclaw.json` with the new agents
- Updates your main agent's TOOLS.md and AGENTS.md with store guidance
- Writes `openclaw-store.lock`

### 5. Verify

```bash
openclaw-store doctor
# ✓ openclaw-store.yaml found
# ✓ openclaw.json found at ~/.openclaw/openclaw.json
# ✓ Lockfile found: 1 pack(s), 1 skill(s)
# ✓ Workspace OK: store__dev-company__pm
# ✓ Workspace OK: store__dev-company__tech-lead
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

**Invoke:** Open the `store__dev-company__pm` agent in OpenClaw and give it a task.

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
openclaw-store install [--dry-run] [--force] # Install from openclaw-store.yaml
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

openclaw-store project status                # Installation overview
openclaw-store project kanban <team-id>      # Show team kanban board

# Health
openclaw-store doctor                        # Full health check
openclaw-store doctor --fix                  # Attempt auto-remediation
```

---

## Customisation Guide

### Override an agent's model

In `openclaw-store.yaml`:

```yaml
version: 1
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

Then point the loader at your override (see [Customising Agents](#customising-agents) in the docs).

### Add a skill

1. Add to `openclaw-store.yaml`:
```yaml
skills:
  - id: last30days
    env:
      OPENAI_API_KEY: required
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
  dir: "~/.openclaw-store/workspaces/store/my-team/shared/memory/"
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

---

## State Files

| File | Location | Committed? | Purpose |
|---|---|---|---|
| `openclaw-store.yaml` | project root | ✓ yes | Which packs/skills at what versions |
| `openclaw-store.lock` | project root | ✓ yes | Resolved dependency tree + workspace paths |
| `~/.openclaw-store/` | home | ✗ no | Agent workspaces + shared memory + cache |
| `~/.openclaw/openclaw.json` | home | ✗ no | Patched by installer (agent list, allowlist) |

---

## Troubleshooting

**`openclaw.json not found`**
OpenClaw isn't installed or `~/.openclaw/` doesn't exist yet. Install OpenClaw first.

**`[INACTIVE] last30days — missing: OPENAI_API_KEY`**
Set the env var and re-run `openclaw-store install`. Skills degrade gracefully when optional vars are missing.

**Agent workspace missing after reinstall**
Run `openclaw-store install --force` to overwrite existing workspace files.

**`openclaw-store doctor` shows errors**
Follow the `→` suggestions printed next to each error. Most are fixed with `openclaw-store install --force`.
