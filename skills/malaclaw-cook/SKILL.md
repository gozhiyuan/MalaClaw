---
name: malaclaw-cook
description: Use when managing projects installed by malaclaw: inspect installed projects, choose entry-point teams and runtime targets, configure communication topologies, add or retarget skills in malaclaw.yaml, run install/diff/doctor, and refresh project agents after project or skill changes.
---

# MalaClaw Manager

This skill manages `malaclaw` projects. It is for project topology, runtime targeting, skill placement, and install health, not for executing end-user work inside the project itself.

`malaclaw` is runtime-agnostic — it provisions agents to OpenClaw, Claude Code, Codex, or ClawTeam via an adapter registry.

It must also work safely when a repo is not yet managed by `malaclaw`.

## Use It For

- Bootstrapping `malaclaw` itself when the user only provided this `SKILL.md`
- Listing installed projects and entry points
- Listing, inspecting, and initializing starter demo projects
- Reading demo-project metadata and starter cards to choose between default workflow and managed workflow
- Promoting an ad hoc workflow into `default-managed` or a fuller managed project
- Choosing and setting the target runtime (`openclaw`, `claude-code`, `codex`, `clawteam`)
- Choosing a communication topology for teams (`star`, `lead-reviewer`, `pipeline`, `peer-mesh`)
- Inspecting a project's manifest, lockfile, and runtime registration
- Adding or removing packs in `malaclaw.yaml`
- Adding a skill to a project and targeting it to the correct agents or teams
- Re-running install so agent workspaces and skills are refreshed
- Checking skill activation, install failures, and agent telemetry

## Core Rules

- First determine whether the repo is in managed mode, default Claude Code mode, default OpenClaw mode, or unconfigured mode.
- Do not assume any runtime auto-installs missing skills.
- Do not assume a project skill is attached to every agent.
- Use the demo-project card and starter metadata to recommend either the default workflow or a managed team install.
- Prefer editing `malaclaw.yaml`, then running `malaclaw diff`, then `malaclaw install`.
- After changing project packs or skills, verify with `malaclaw doctor` and `malaclaw skill check`.
- Do not remove packs or skills unless the user asked for that change.
- malaclaw is the project and orchestration layer. The runtime (OpenClaw, Claude Code, Codex, or ClawTeam) owns agent sessions, memory, and skill execution.
  malaclaw scaffolds the project structure, agents, topology, and skill targeting.
- Single-agent mode: use `default-managed` starter — one generalist agent, no team overhead.
  Do not build a full team unless the user explicitly wants multi-agent coordination.
- Available bundled teams: dev-company, content-factory, research-lab, autonomous-startup, personal-assistant, automation-ops, customer-service, finance-ops, data-ops
- Skills are per agent, not per team. Each agent YAML declares its own skills list.

## Runtime Targeting

### Supported Runtimes

| Runtime | Manifest value | What install does | Best for |
|---|---|---|---|
| OpenClaw | `openclaw` (default) | Patches `openclaw.json`, creates agent workspace dirs | Full multi-agent orchestration with Gateway |
| Claude Code | `claude-code` | Generates `CLAUDE.md` per agent workspace | Claude Code users who want team structure |
| Codex | `codex` | Generates `AGENTS.md` per agent workspace | Codex users who want team structure |
| ClawTeam | `clawteam` | Exports `team.toml` + spawn catalog | Advanced topologies (pipeline, peer-mesh) |

### How to Choose a Runtime

Ask the user which tool they are already using:
- Already using OpenClaw → `runtime: openclaw`
- Already using Claude Code → `runtime: claude-code`
- Already using Codex → `runtime: codex`
- Need pipeline or peer-mesh topology → `runtime: clawteam`
- Not sure → default to `openclaw`

Set the runtime in `malaclaw.yaml`:

```yaml
version: 1
runtime: clawteam    # or openclaw (default), claude-code, codex
packs:
  - id: dev-company
```

### Runtime-Specific Handoff

After install, the handoff differs by runtime:

- **OpenClaw:** "Open this agent in OpenClaw: `store__<project>__<team>__<agent>`"
- **Claude Code:** "Open the agent workspace and start Claude Code. Your context is in `CLAUDE.md`."
- **Codex:** "Open the agent workspace and start Codex. Your context is in `AGENTS.md`."
- **ClawTeam:** "Start the team with ClawTeam. The team definition is in `team.toml`."

## Communication Topologies

### Topology Types

| Topology | Description | Runtime support |
|---|---|---|
| **star** | All tasks flow through the lead. Workers report only to the lead. | All runtimes |
| **lead-reviewer** | Tasks flow through lead. Workers may request review from designated reviewers. | OpenClaw, ClawTeam |
| **pipeline** | Tasks flow sequentially through stages. Each agent passes to next. | ClawTeam only |
| **peer-mesh** | Agents may communicate with any other agent via shared memory. | ClawTeam only |

### How to Choose a Topology

- **Default to star** unless the user describes a workflow that clearly fits another pattern.
- Use **lead-reviewer** when the user mentions code review, quality gates, or approval steps.
- Use **pipeline** when the user describes sequential stages (e.g., "research → write → edit → publish").
- Use **peer-mesh** when agents need to coordinate freely without a central lead.
- If the user's chosen topology is incompatible with their runtime, warn them: it will be downgraded to star.

### Setting Topology

Topology can be declared explicitly in team YAML:

```yaml
communication:
  topology: lead-reviewer
  enforcement: strict    # or "advisory" (default)
```

Or omitted — `malaclaw` will auto-infer from the team's delegation graph. Use `malaclaw team show <id>` to see the resolved topology.

### Topology Downgrade Rules

When a topology is incompatible with the target runtime, agents receive star-topology coordination rules instead:

| Topology | Downgrades on |
|---|---|
| lead-reviewer | Claude Code, Codex |
| pipeline | Claude Code, Codex, OpenClaw |
| peer-mesh | Claude Code, Codex, OpenClaw |

If the user wants pipeline or peer-mesh and is on OpenClaw, recommend switching to `runtime: clawteam`.

## Workflow

### 0. Bootstrap `malaclaw` if needed

If the user gave you this `SKILL.md` directly and `malaclaw` is not yet available:

1. Check whether `malaclaw` is already on PATH.
2. If not, acquire the repo locally:
   - if the current workspace is already the `malaclaw` repo, use it
   - otherwise clone the repo the user referenced
3. From the repo root, run:
   - `npm install`
   - `npm run build`
   - `npm link`
4. Verify with:
   - `malaclaw --help`
5. Then continue with the normal zero-config bootstrap:
   - `malaclaw install`

If the user does not want a local CLI install, explain that this skill can still guide the workflow conceptually, but project initialization and managed install steps require the `malaclaw` command to exist locally.

### 1. Inspect the current state

Run the smallest commands that answer the question:

- `malaclaw starter list`
- `malaclaw starter show <starter-id>`
- `malaclaw starter suggest "<idea>"`
- `malaclaw project list`
- `malaclaw project show <project-id>`
- `malaclaw project status`
- `malaclaw team show <team-id>`
- `malaclaw agent show <agent-id>`
- `malaclaw skill show <skill-id>`
- `malaclaw skill sync`

If the user asks which agent to use, prefer the project entry-point agent from `project show`. Give the runtime-appropriate handoff (see Runtime-Specific Handoff above).

If the repo is not managed yet:

- explain which default workflow was detected
- do not claim missing `malaclaw.yaml` is an error by itself
- ask which runtime the user is currently using
- suggest `malaclaw init` only when the user wants managed projects, teams, or skills

If the user already has a working ad hoc workflow and wants structure:

1. inspect the current repo and runtime state
2. ask which runtime they are using (OpenClaw, Claude Code, Codex, ClawTeam)
3. list the skills they already rely on
4. decide whether they need:
   - default workflow only
   - `default-managed`
   - a fuller starter/team install
5. if the workflow is repeated, shared, or coordination-heavy, recommend promotion
6. create or edit `malaclaw.yaml` with the correct `runtime:` field
7. target discovered skills into the project
8. run `malaclaw install`
9. give the runtime-specific handoff

If the user is starting from an idea:

1. run `malaclaw starter suggest "<idea>"`
2. inspect the closest starter with `starter show`
3. inspect the matching demo card in `demo-projects/cards/<starter-id>.md` when you need setup or workflow guidance
4. decide whether the user should stay in default workflow mode or move into managed starter mode
5. if a starter is close enough, run `starter init`
6. edit the generated `malaclaw.yaml` to customize packs, skills, or targets
7. run `malaclaw install`

If no starter is close enough:

- prefer `default-managed` for a lightweight managed starting point
- otherwise choose the simplest relevant starter anyway
- initialize it
- modify the generated project manifest rather than building everything from scratch
- explain which parts were inherited vs customized

### 1b. Promote to project

When the user says things like:

- "turn this into a project"
- "make this repeatable"
- "I already have the skills, now organize it"
- "should this become a team"

follow this promotion flow:

1. detect current mode: default OpenClaw, default Claude Code, or already managed
2. ask which runtime they want to target (default to what they're already using)
3. inspect currently available skills with `malaclaw skill sync`
4. identify whether the workflow is:
   - single-agent but persistent
   - multi-step with repeated tools (consider pipeline topology)
   - multi-agent or delegation-heavy (consider star or lead-reviewer)
   - peer-to-peer collaborative (consider peer-mesh, requires ClawTeam)
5. recommend:
   - stay unmanaged
   - `default-managed`
   - closest starter + customization
6. if recommending multi-agent, suggest the appropriate topology
7. initialize the project with the correct `runtime:` field
8. attach or retarget existing skills
9. run install, then give the runtime-specific handoff

### 2. Add or retarget a skill

When a project needs a skill:

1. Confirm the skill exists as a template
   or is already available in OpenClaw via `malaclaw skill list` / `skill sync`
2. Edit `malaclaw.yaml`
3. Add the skill under `skills:`
4. Target it to the correct agents or teams with `targets.agents` or `targets.teams`
5. Run `malaclaw diff`
6. Run `malaclaw install`
7. Run `malaclaw skill check`
8. If the user asked for a stronger refresh, run `malaclaw install --force`

If the skill is an external OpenClaw skill rather than a repo-bundled one:

1. tell the user which skill or API integration is missing
2. guide them to install or configure it in OpenClaw first
3. verify it exists locally
4. run `malaclaw skill sync` if you want to refresh the local availability inventory
5. then re-run `malaclaw install` so it is attached to the targeted agents

Example:

```yaml
skills:
  - id: malaclaw-cook
    targets:
      agents:
        - tech-lead
        - ceo
```

Or team-wide:

```yaml
skills:
  - id: github
    targets:
      teams:
        - dev-company
```

### 3. Handle missing or inactive skills

If install reports a missing skill source:

- check `malaclaw skill show <skill-id>`
- inspect the skill's source and install hints
- use the demo card's `installable_skills`, `required_apis`, `required_capabilities`, and `setup_guidance` to explain the missing dependency in project terms
- do not claim the skill is installed until `skill check` or install output confirms it

If install reports inactive status:

- check required environment variables
- explain what is missing
- re-run install after configuration is fixed

### 4. Verify skill is in agent's allowlist

OpenClaw uses `agent.skills[]` in openclaw.json as a skill filter:

- **omit** `skills` key = agent has unrestricted access to all skills
- **`skills: []`** = agent has access to no skills (empty allowlist)
- **`skills: [...]`** = only the listed skill IDs are available to the agent

If install succeeds but a skill isn't loading in an agent session, check whether the agent's entry in openclaw.json has a `skills:` key that excludes it. Re-running `malaclaw install` automatically patches this — it adds installed skill IDs to any agent entries that already have an explicit `skills[]` allowlist.

### 5. Runtime-specific memory and context

Two distinct memory mechanisms exist in malaclaw managed projects:

**Runtime-native memory** (runtime-owned):
- **OpenClaw:** `memory_search` and `memory_get` index files in each agent's workspace (MEMORY.md, memory/*.md)
- **Claude Code:** context comes from the generated `CLAUDE.md` in each agent workspace
- **Codex:** context comes from the generated `AGENTS.md` in each agent workspace
- **ClawTeam:** context comes from `team.toml` and per-agent prompt dirs

**Shared team markdown files** (malaclaw convention):
- kanban.md, tasks-log.md, etc. are scaffolded by malaclaw as coordination files
- They live **outside** each agent's indexed workspace (in the team's shared memory directory)
- Access them **by file path**, not via runtime-native memory search — they are not indexed by any runtime
- They are a project/team coordination layer, not a replacement for native memory

See MEMORY.md (OpenClaw) or the generated prompt file (other runtimes) in each agent workspace for the exact paths and access patterns.

### 6. Agent telemetry

After install, each agent has telemetry at `~/.malaclaw/agents/<agentId>/state.json`.

- **Status values:** `idle`, `working`, `error`, `offline`
- **Source values:** `gateway` (OpenClaw), `clawteam` (ClawTeam state), `heartbeat` (future), `manual` (install-time)
- **TTL:** status auto-downgrades to `idle` after `ttlSeconds` (default 300s) with no update

The dashboard reads these files for runtime-agnostic agent monitoring. Use `malaclaw dashboard` to view live status.

## Project Initialization Flow

When a user asks to spin up a project or demo, follow this sequence exactly:

### Step 1: Suggest a starter
Run `malaclaw starter suggest "<user idea>"`.
Present the closest match: name, entry team, project skills, installable skills, required APIs, and required capabilities.

### Step 2: Confirm and initialize
Once the user confirms the starter and target directory:
- If the demo is `family-calendar-household-assistant`: ask "Do you use Google Calendar or Apple Calendar?" and note the answer — you will target only the user's chosen calendar skill during install.
- Run `malaclaw starter init <starter-id> <dir>`
  This creates: `malaclaw.yaml`, `STARTER.md`, `DEMO_PROJECT.md`

### Step 3: Detect skill gaps
Run `malaclaw skill sync`
- This checks what is already installed in OpenClaw
- Compare against the project's targeted skills and the demo card's `installable_skills`
- If skill sync fails (OpenClaw offline or unreachable): warn the user and ask them to confirm each required skill manually before you proceed

### Step 4: Guide missing skills and auth
For each missing or inactive skill the user wants in the project:
1. State which skill is missing and which agent(s) need it
2. If it is an OpenClaw skill, guide the user to install it in OpenClaw first
3. Use `malaclaw skill show <skill-id>` and demo metadata to explain env vars or API auth that are still missing
4. Re-run `malaclaw skill sync` to confirm presence when relevant
5. Only target the skill into the managed project once it exists or the user explicitly wants to proceed without it

### Step 5: Install
After the starter and skill targeting are in the right state, run the managed install.

Run from the project directory:
```
cd <dir>
malaclaw install
```

### Step 6: Verify
Run `malaclaw doctor`
All installed agents and targeted skills should be healthy.

### Step 7: Hand off to user
Tell the user:
- The exact agent ID (the entry-point agent from `project show`)
- Runtime-specific instructions for how to start using it
- A concrete first task to give that agent, based on the demo's bootstrap_prompt

Example handoffs by runtime:

**OpenClaw:**
"Your Habit Tracker is ready. Open this agent in OpenClaw:
→ `store__<project-id>__personal-assistant__personal-assistant-lead`

Give it a task like:
'Set up daily habit tracking for: morning exercise, reading 30 mins, and no phone after 9pm.'"

**Claude Code:**
"Your Habit Tracker is ready. Open the agent workspace:
→ `~/.malaclaw/workspaces/store/<project-id>/personal-assistant/personal-assistant-lead/`
Start Claude Code in that directory. Your context is in `CLAUDE.md`."

**Codex:**
"Your Habit Tracker is ready. Open the agent workspace:
→ `~/.malaclaw/workspaces/store/<project-id>/personal-assistant/personal-assistant-lead/`
Start Codex in that directory. Your context is in `AGENTS.md`."

**ClawTeam:**
"Your Habit Tracker is ready. Start the team with ClawTeam:
→ Team definition: `~/.malaclaw/workspaces/store/<project-id>/personal-assistant/team.toml`"

## Reference

Read [references/commands.md](references/commands.md) when you need the exact command set or manifest patterns.
