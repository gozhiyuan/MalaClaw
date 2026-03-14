---
name: openclaw-store-manager
description: Use when managing projects installed by openclaw-store: inspect installed projects, choose entry-point teams, add or retarget skills in openclaw-store.yaml, run install/diff/doctor, and refresh project agents after project or skill changes.
---

# OpenClaw Store Manager

This skill manages `openclaw-store` projects. It is for project topology, skill placement, and install health, not for executing end-user work inside the project itself.

It must also work safely when a repo is not yet managed by `openclaw-store`.

## Use It For

- Listing installed projects and entry points
- Listing, inspecting, and initializing starter demo projects
- Reading demo-project metadata and starter cards to choose between default workflow and managed workflow
- Inspecting a project's manifest, lockfile, and runtime registration
- Adding or removing packs in `openclaw-store.yaml`
- Adding a skill to a project and targeting it to the correct agents or teams
- Re-running install so agent workspaces and skills are refreshed
- Checking skill activation and install failures

## Core Rules

- First determine whether the repo is in managed mode, default Claude Code mode, default OpenClaw mode, or unconfigured mode.
- Do not assume OpenClaw auto-installs missing skills.
- Do not assume a project skill is attached to every agent.
- Use the demo-project card and starter metadata to recommend either the default workflow or a managed team install.
- Prefer editing `openclaw-store.yaml`, then running `openclaw-store diff`, then `openclaw-store install`.
- After changing project packs or skills, verify with `openclaw-store doctor` and `openclaw-store skill check`.
- Do not remove packs or skills unless the user asked for that change.
- openclaw-store runs ON TOP OF OpenClaw. OpenClaw is the runtime (memory, skills, sessions).
  openclaw-store scaffolds the project structure, agents, and skill targeting.
- Single-agent mode: use `default-managed` starter — one generalist agent, no team overhead.
  Do not build a full team unless the user explicitly wants multi-agent coordination.

## Workflow

### 1. Inspect the current state

Run the smallest commands that answer the question:

- `openclaw-store starter list`
- `openclaw-store starter show <starter-id>`
- `openclaw-store starter suggest "<idea>"`
- `openclaw-store project list`
- `openclaw-store project show <project-id>`
- `openclaw-store project status`
- `openclaw-store team show <team-id>`
- `openclaw-store agent show <agent-id>`
- `openclaw-store skill show <skill-id>`

If the user asks which agent to open in OpenClaw, prefer the project entry-point agent from `project show`.

If the repo is not managed yet:

- explain which default workflow was detected
- do not claim missing `openclaw-store.yaml` is an error by itself
- suggest `openclaw-store init` only when the user wants managed projects, teams, or skills

If the user is starting from an idea:

1. run `openclaw-store starter suggest "<idea>"`
2. inspect the closest starter with `starter show`
3. inspect the matching demo card in `demo-projects/cards/<starter-id>.md` when you need setup or workflow guidance
4. decide whether the user should stay in default workflow mode or move into managed starter mode
5. if a starter is close enough, run `starter init`
6. edit the generated `openclaw-store.yaml` to customize packs, skills, or targets
7. run `openclaw-store install`

If no starter is close enough:

- prefer `default-managed` for a lightweight managed starting point
- otherwise choose the simplest relevant starter anyway
- initialize it
- modify the generated project manifest rather than building everything from scratch
- explain which parts were inherited vs customized

### 2. Add or retarget a skill

When a project needs a skill:

1. Confirm the skill exists as a template
2. Edit `openclaw-store.yaml`
3. Add the skill under `skills:`
4. Target it to the correct agents or teams with `targets.agents` or `targets.teams`
5. Run `openclaw-store diff`
6. Run `openclaw-store install`
7. Run `openclaw-store skill check`
8. If the user asked for a stronger refresh, run `openclaw-store install --force`

If the skill is an external OpenClaw skill rather than a repo-bundled one:

1. tell the user which skill or API integration is missing
2. guide them to install or configure it in OpenClaw first
3. verify it exists locally
4. then re-run `openclaw-store install` so it is attached to the targeted agents

Example:

```yaml
skills:
  - id: openclaw-store-manager
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

- check `openclaw-store skill show <skill-id>`
- inspect the skill's source and install hints
- use the demo card's `external_requirements` and `setup_guidance` to explain the missing dependency in project terms
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

If install succeeds but a skill isn't loading in an agent session, check whether the agent's entry in openclaw.json has a `skills:` key that excludes it. Re-running `openclaw-store install` automatically patches this — it adds installed skill IDs to any agent entries that already have an explicit `skills[]` allowlist.

### 5. OpenClaw memory tools

Two distinct memory mechanisms exist in openclaw-store managed projects:

**OpenClaw native memory** (runtime-owned):
- `memory_search` and `memory_get` are native OpenClaw tools
- They index files in **this agent's own workspace directory** (MEMORY.md, memory/*.md)
- Each agent workspace includes a MEMORY.md that explains this

**Shared team markdown files** (openclaw-store convention):
- kanban.md, tasks-log.md, etc. are scaffolded by openclaw-store as coordination files
- They live **outside** each agent's indexed workspace (in the team's shared memory directory)
- Access them **by file path**, not via `memory_search` — they are not indexed by OpenClaw
- They are a project/team coordination layer on top of OpenClaw, not a replacement for native memory

See MEMORY.md in each agent workspace for the exact paths and access patterns.

Note: Claude Code remains unsupported as a runtime target until a real adapter is built
(`src/lib/adapters/claude-code.ts` is still a stub). Use OpenClaw as the runtime.

## Reference

Read [references/commands.md](references/commands.md) when you need the exact command set or manifest patterns.
