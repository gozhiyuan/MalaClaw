# CLAUDE.md — openclaw-store

AI assistant guide for the `openclaw-store` repository. Read this before making changes.

---

## What This Repo Is

`openclaw-store` is a CLI tool + template library that installs pre-built multi-agent teams into OpenClaw. It is **not** a product or app. It is an orchestration layer — think of it as npm for OpenClaw agent projects.

The repo provides:
- A Node.js CLI (`openclaw-store`) built on TypeScript + Commander
- Bundled agent/team/skill/pack YAML templates under `templates/` and `packs/`
- 36+ curated starter demo project definitions under `starters/` and `demo-projects/`
- A `skills/openclaw-store-manager/` skill that can be installed into OpenClaw itself

---

## Directory Structure

```
openclaw-store/
├── src/                    ← TypeScript source (compiled to dist/)
│   ├── cli.ts              ← Commander entry point — all subcommands registered here
│   ├── commands/           ← One file per top-level command (install, starter, project, skill, ...)
│   └── lib/
│       ├── schema.ts       ← All Zod schemas and inferred types (canonical source of truth for data shapes)
│       ├── loader.ts       ← YAML → validated TypeScript types (with overlay support)
│       ├── resolver.ts     ← manifest → concrete install plan (ResolveResult + Lockfile)
│       ├── renderer.ts     ← AgentDef + TeamDef → rendered Markdown bootstrap files
│       ├── paths.ts        ← All filesystem path resolution (env var overrides live here)
│       ├── project-meta.ts ← Project ID, name, and entry team derived from manifest
│       ├── memory.ts       ← Shared memory file seeding
│       ├── runtime.ts      ← Read/write ~/.openclaw-store/runtime.json
│       ├── skill-fetch.ts  ← Skill caching and symlinking
│       ├── team-graph.ts   ← Team delegation graph utilities
│       ├── workflow-mode.ts← Detect managed vs Claude Code vs OpenClaw vs unconfigured mode
│       ├── openclaw-agents.ts ← Discover native OpenClaw agents from openclaw.json
│       ├── openclaw-skills.ts ← Discover native OpenClaw skills for skill sync
│       └── adapters/
│           ├── openclaw.ts  ← Full implementation: provision agents, patch openclaw.json, upsert guidance blocks
│           └── claude-code.ts ← STUB — not implemented yet
├── templates/
│   ├── agents/             ← One YAML file per agent template (AgentDef schema)
│   ├── teams/              ← One YAML file per team (TeamDef schema)
│   └── skills/             ← One YAML file per skill (SkillEntry schema)
├── packs/                  ← Pack definitions (PackDef schema) — reference teams by ID
├── starters/               ← Starter YAML definitions (StarterDef schema)
├── demo-projects/
│   ├── index.yaml          ← Generated index of all demo projects (DemoProjectIndex schema)
│   └── cards/              ← Per-demo Markdown cards with setup and execution guidance
├── skills/
│   └── openclaw-store-manager/ ← The manager skill installed into OpenClaw itself
├── partials/               ← Shared Markdown fragments used by the renderer
├── dashboard/              ← Web dashboard (Fastify server + React SPA)
│   ├── server/             ← Fastify server, REST routes, WebSocket, file watcher
│   │   ├── index.ts        ← Server entry: Fastify + WS + CORS + SPA fallback
│   │   ├── ws.ts           ← WebSocket client registry and broadcast
│   │   ├── watcher.ts      ← chokidar file watcher → WS event broadcast
│   │   ├── services/store.ts ← Service bridge wrapping src/lib/ imports
│   │   └── routes/         ← One file per resource (projects, agents, teams, skills, etc.)
│   ├── src/                ← React 19 SPA
│   │   ├── hooks/useApi.ts ← TanStack Query hooks for all API endpoints
│   │   ├── hooks/useWs.ts  ← WebSocket auto-reconnect + query invalidation
│   │   ├── components/     ← 11 panel components (AgentList, SkillTable, KanbanBoard, etc.)
│   │   ├── pages/          ← Dashboard, Projects, Starters, Config
│   │   └── lib/types.ts    ← Frontend TypeScript types
│   ├── package.json        ← Separate deps: fastify, react, @tanstack/react-query, vite
│   ├── tsconfig.server.json ← Server config with project reference to root
│   └── tsconfig.json       ← Frontend config (moduleResolution: bundler)
├── scripts/                ← Code generation scripts (e.g. generate-starters-from-usecases.mjs)
├── tests/                  ← Vitest test suite
└── dist/                   ← Compiled output (gitignored in practice, do not edit)
```

---

## Core Data Pipeline

```
openclaw-store.yaml          (desired state — committed to git)
       ↓ loadManifest()
  Manifest (Zod type)
       ↓ resolveManifest()
  ResolveResult              (concrete agents, workspaces, skill statuses)
       ↓ installTeam() per pack
       ├── renderBootstrapFiles() → SOUL.md, IDENTITY.md, TOOLS.md, AGENTS.md, USER.md
       ├── seedTeamSharedMemory() → kanban.md, tasks-log.md, etc.
       ├── upsertAgentEntries()   → patches ~/.openclaw/openclaw.json
       └── updateStoreGuidance()  → upserts block in main agent TOOLS.md / AGENTS.md
       ↓ writeLockfile()
openclaw-store.lock          (resolved state — committed to git, do not edit manually)
       ↓
~/.openclaw-store/runtime.json  (global project registry — NOT committed)
```

**Analogy:** `openclaw-store.yaml` : `openclaw-store.lock` :: `package.json` : `package-lock.json`

---

## Key Conventions

### Agent ID Format

All store-managed agents use this naming convention:
```
store__<project-id>__<team-id>__<agent-id>
```
Example: `store__my-project__dev-company__pm`

This is enforced by `resolveAgentId()` in `src/lib/paths.ts`. Never construct agent IDs by hand — use that function.

### Template Overlay

The loader always checks `OPENCLAW_STORE_TEMPLATES` (env var) or `./templates/` (project-local) before falling back to the bundled templates. This overlay pattern applies to agents, teams, and skills. Do not hard-code template paths — use the loader functions.

### `{{variable}}` Substitution

Agent YAML `soul.persona`, `soul.tone`, and `soul.boundaries[]` support `{{dot.path}}` substitution via `substitute()` in `renderer.ts`. Available context:

```
{{agent.id}}           → "tech-lead"
{{agent.name}}         → "Tech Lead"
{{agent.model.primary}}→ "claude-opus-4-5"
{{team.id}}            → "dev-company"
{{team.name}}          → "Dev Company"
```

### Tagged-Block Patching

The openclaw adapter injects guidance into `TOOLS.md` / `AGENTS.md` using idempotent HTML comment blocks:
```
<!-- openclaw-store -->
...content...
<!-- /openclaw-store -->
```
`upsertBlock()` replaces in place if it exists; appends if not. `removeBlock()` strips it cleanly on uninstall. Never write these files by hand — use the adapter functions.

### Shared Memory Access Patterns

Three patterns only. No exceptions:
- `single-writer: <agent-id>` — only one agent can overwrite
- `append-only: "*"` — any agent can append, no overwrites
- `private: <agent-id>` — only that agent reads/writes

These are enforced by the renderer: each agent gets a different AGENTS.md view of the same shared memory config.

---

## Schema Reference (src/lib/schema.ts)

All data shapes are defined as Zod schemas in `schema.ts`. Always use the inferred types — never write raw interfaces for these.

| Schema | File pattern | Purpose |
|---|---|---|
| `AgentDef` | `templates/agents/*.yaml` | Agent identity, soul, capabilities, model |
| `TeamDef` | `templates/teams/*.yaml` | Members, graph edges, shared memory |
| `SkillEntry` | `templates/skills/*.yaml` | Skill source, env requirements, trust tier |
| `PackDef` | `packs/*.yaml` | Teams grouped into an installable pack |
| `StarterDef` | `starters/*.yaml` | Curated starter definition with use case + bootstrap prompt |
| `DemoProjectDef` | `demo-projects/index.yaml` | Richer demo card with execution modes and setup guidance |
| `Manifest` | `openclaw-store.yaml` | Desired state (packs + skills + project metadata) |
| `Lockfile` | `openclaw-store.lock` | Resolved state (exact agents, workspaces, skill statuses) |
| `RuntimeState` | `~/.openclaw-store/runtime.json` | Global project registry |
| `SkillInventory` | `~/.openclaw-store/skills-index.json` | Discovered skill availability index |

---

## Environment Variables

All paths and directories can be overridden via env vars. See `src/lib/paths.ts` for the full list.

| Env var | Default | Purpose |
|---|---|---|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | OpenClaw config root |
| `OPENCLAW_CONFIG_PATH` | `~/.openclaw/openclaw.json` | OpenClaw config file |
| `OPENCLAW_STORE_DIR` | `~/.openclaw-store` | Store runtime root |
| `OPENCLAW_STORE_TEMPLATES` | none | Custom template overlay directory |
| `OPENCLAW_STORE_BUNDLED_TEMPLATES` | `<pkg-root>/templates` | Override bundled templates root |
| `OPENCLAW_STORE_PACKS_DIR` | `<pkg-root>/packs` | Override packs directory |
| `OPENCLAW_STORE_STARTERS_DIR` | `<pkg-root>/starters` | Override starters directory |
| `OPENCLAW_STORE_DEMO_PROJECTS_DIR` | `<pkg-root>/demo-projects` | Override demo projects directory |

Tests use these to point at fixture data rather than production state.

---

## Development Workflow

```bash
npm install          # install deps
npm run build        # TypeScript compile → dist/
npm link             # make `openclaw-store` available globally
npm test             # vitest run (all tests)
npm run test:watch   # watch mode
npm run test:coverage

openclaw-store validate  # validate all bundled templates against Zod schemas
```

Always run `npm run build` before testing CLI behavior. The CLI runs from `dist/`, not `src/`.

### Dashboard Development

```bash
cd dashboard
npm install          # dashboard deps (separate from root)
npm test             # vitest run (dashboard server tests)

# Dev mode (two terminals):
npx tsx server/index.ts        # Fastify server on :3456
npx vite                       # Vite dev server on :5173 (proxies /api → :3456)

# Production build:
npx vite build                 # React → dashboard/dist/client/
npx tsc -p tsconfig.server.json  # Server → dashboard/dist/server/
```

The dashboard server imports from `../../dist/lib/` (the root project's compiled output), so always run `npm run build` in the root first.

---

## Testing

Tests live in `tests/`. Vitest is the runner (`vitest.config.ts`). Tests are ESM-native.

Test files and what they cover:

| File | What it tests |
|---|---|
| `schema.test.ts` | Zod schema validation for all data types |
| `renderer.test.ts` | Bootstrap file rendering, `{{variable}}` substitution |
| `resolver.test.ts` | `resolveManifest()` — pack → agent ID resolution, skill env checking |
| `loader.ts` (via resolver) | YAML loading with overlay precedence |
| `overlay.test.ts` | Custom template overlay via `OPENCLAW_STORE_TEMPLATES` |
| `compat.test.ts` | Pack compatibility checks (`openclaw_min`, `node_min`) |
| `skill-fetch.test.ts` | Skill caching and symlinking |
| `starter.test.ts` | Starter list, show, suggest, init |
| `install.test.ts` | Full install flow (uses fixtures, not real filesystem) |
| `diff.test.ts` | Diff between manifest and current lockfile |
| `workflow-mode.test.ts` | Mode detection (managed / Claude Code / OpenClaw / unconfigured) |
| `openclaw-agents.test.ts` | Native OpenClaw agent discovery |
| `openclaw-skills.test.ts` | Native OpenClaw skill discovery |
| `doctor.test.ts` | `runChecks()` findings, severity levels, side-effect-free verification |
| `diff-lib.test.ts` | `computeDiff()` — added/removed/changed entries |
| `install-headless.test.ts` | `runHeadlessInstall()` dryRun, onProgress, projectId |
| `skill-ops.test.ts` | `checkSkills()` and `syncSkills()` return shapes |
| `starter-ops.test.ts` | `initStarter()`, `suggestStarters()`, helper functions |

Dashboard tests live in `dashboard/server/__tests__/`:

| File | What it tests |
|---|---|
| `routes.test.ts` | All 8 REST route groups via Fastify inject() |

Test fixtures are in `tests/fixtures/`. Use env var overrides to point tests at fixtures instead of real system state.

---

## How to Add Templates

### New agent

1. Create `templates/agents/<id>.yaml` following the `AgentDef` schema
2. `sessions_spawn: true` only for leads. `sessions_send: false` always.
3. Reference the agent by ID in a team YAML

### New team

1. Create `templates/teams/<id>.yaml` following the `TeamDef` schema
2. Exactly one `entry_point: true` member
3. Declare all shared memory files with explicit `access` and `writer`

### New pack

1. Create `packs/<id>.yaml` following the `PackDef` schema
2. Reference team IDs (not agent IDs) in the `teams:` list

### New skill template

1. Create `templates/skills/<id>.yaml` following the `SkillEntry` schema
2. Set `disabled_until_configured: true` if env vars are required
3. Reference the skill ID in agent YAML `skills:` or target it from the project manifest

### New starter

1. Create `starters/<id>.yaml` following the `StarterDef` schema
2. Create `demo-projects/cards/<id>.md` with the richer demo card
3. Add an entry to `demo-projects/index.yaml` following the `DemoProjectDef` schema

Run `openclaw-store validate` after adding any template to confirm the YAML is schema-valid.

---

## Important Constraints

- **`claude-code.ts` adapter is a stub.** The Claude Code runtime adapter (`src/lib/adapters/claude-code.ts`) is not implemented. Only the OpenClaw adapter is real. Do not build features that assume a working Claude Code install target.
- **OpenClaw is the runtime.** `openclaw-store` scaffolds structure and configuration. OpenClaw owns agent sessions, memory indexing, and skill execution.
- **Lockfile is machine-generated.** Never edit `openclaw-store.lock` by hand. It is written by `writeLockfile()` during install.
- **`install` is the reconciliation point.** Changing `openclaw-store.yaml` has no effect until `openclaw-store install` is re-run.
- **Skill placement is not automatic.** A skill must appear in the agent template's `skills:` list OR be targeted via `targets.agents` / `targets.teams` in the manifest. OpenClaw does not auto-install missing skills.
- **Shared memory files use file paths, not OpenClaw memory search.** The `kanban.md`, `tasks-log.md`, etc. are coordination files accessed by direct path. They are NOT indexed by OpenClaw's `memory_search` tool.
- **Node.js ≥ 22 required.** Set in `package.json` `engines` field.
- **Dashboard has its own `package.json`.** The `dashboard/` directory is a separate npm project with its own dependencies. It imports from `../../dist/lib/` via the store service bridge at `dashboard/server/services/store.ts`. Always build the root project first (`npm run build`) before running the dashboard.
- **Dashboard server uses TypeScript project references.** `dashboard/tsconfig.server.json` has `"references": [{ "path": ".." }]` pointing to the root tsconfig. This enables type-safe imports from `dist/lib/` with proper declaration files.

---

## Workflow Modes

`src/lib/workflow-mode.ts` detects which mode a repo is in:

| Mode | Detection | Behavior |
|---|---|---|
| `managed` | `openclaw-store.yaml` present | Full project/team/skill management |
| `claude-code` | `CLAUDE.md` or `.claude/` present, no manifest | Treated as default Claude Code project |
| `openclaw` | OpenClaw installed, no manifest | Treated as default OpenClaw environment |
| `unconfigured` | None of the above | Offer to bootstrap |

When there is no manifest, `openclaw-store install` runs `runZeroConfigInstall()` which installs the `openclaw-store-manager` skill into the main OpenClaw workspace instead of failing.

---

## State File Summary

| File | Location | Committed? | Purpose |
|---|---|---|---|
| `openclaw-store.yaml` | project root | yes | Desired state — packs, skills, project metadata |
| `openclaw-store.lock` | project root | yes | Resolved state — exact agent IDs, workspaces, skill statuses |
| `~/.openclaw-store/runtime.json` | home | no | Global registry of installed projects |
| `~/.openclaw-store/workspaces/` | home | no | Agent workspace files (SOUL.md, TOOLS.md, etc.) |
| `~/.openclaw/openclaw.json` | home | no | Patched by install — agent list, allowlists |

## Dashboard Architecture

The web dashboard lives in `dashboard/` and provides a visual interface to all store management operations.

**Server stack:** Fastify + @fastify/websocket + chokidar
**Client stack:** React 19 + TanStack Query v5 + Vite + react-router-dom v7

```
Browser ←→ Fastify (:3456)
              ├── REST /api/* → services/store.ts → dist/lib/*.js
              ├── WS /ws → broadcast file-change events
              └── Static files (production) or Vite proxy (dev)

chokidar watches:
  ~/.openclaw-store/runtime.json
  ~/.openclaw-store/skills-index.json
  <project>/openclaw-store.yaml
  <project>/openclaw-store.lock
  <project>/shared/memory/*.md
```

**Key patterns:**
- REST for data fetching, WebSocket for "something changed" notifications
- WebSocket events trigger React Query invalidation (not data transfer)
- Store service bridge (`dashboard/server/services/store.ts`) wraps all `src/lib/` imports
- Install mutex prevents concurrent installs via the manifest route
- SPA fallback in production (non-API routes serve `index.html`)
