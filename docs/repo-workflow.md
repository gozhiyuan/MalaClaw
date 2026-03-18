# Using This Repo

This repo gives you a CLI, built-in packs, team templates, and skill templates for multi-agent runtimes (OpenClaw, Claude Code, Codex, ClawTeam).

## 1. Install the CLI from this repo

From the repo root:

```bash
npm install
npm run build
npm link
```

This makes `malaclaw` available on your machine.

## 2. Bootstrap OpenClaw or start a project

You can either bootstrap OpenClaw first, or immediately start a managed project.

OpenClaw-first bootstrap:

```bash
malaclaw install
```

If there is no `malaclaw.yaml`, this installs the `malaclaw-cook` skill into the main OpenClaw workspace and updates the main guidance files. It does not require a project folder yet.

The demo catalog lives in:

- `demo-projects/index.yaml`
- `demo-projects/cards/<starter-id>.md`

From a starter:

```bash
malaclaw starter list
malaclaw starter suggest "podcast workflow"
malaclaw starter init podcast-production-pipeline ./my-podcast-project
cd ./my-podcast-project
```

`starter init` creates the target folder if it does not already exist.

For the lightest managed setup:

```bash
malaclaw starter show default-managed
malaclaw starter init default-managed ./my-project
```

For a new project:

```bash
mkdir my-project
cd my-project
malaclaw init
```

For an existing project:

```bash
cd my-project
malaclaw init
```

The wizard creates `malaclaw.yaml`, which declares which packs and skills the project wants.
It also writes a `project` block so installs are namespaced by project ID.
This is the scratch/manual managed path, not the only entry path.

Important boundary:

- `malaclaw.yaml` is the project authoring format for `malaclaw`
- OpenClaw itself runs from the rendered workspace files, not directly from this YAML
- `install` is the compilation/reconciliation step that turns YAML into OpenClaw-ready workspaces

## 3. Preview and install

```bash
malaclaw install --dry-run
malaclaw install
malaclaw doctor
```

This installs the selected teams, seeds shared memory files, writes initial agent telemetry, and provisions workspaces via the runtime adapter.

By default, install targets OpenClaw (patches `~/.openclaw/openclaw.json`). Set `runtime:` in `malaclaw.yaml` to target a different runtime:

```yaml
version: 1
runtime: clawteam    # or openclaw (default), claude-code, codex
```

Starter-based projects also include `DEMO_PROJECT.md`, copied from the richer demo card.

The installed agent workspaces contain runtime-specific files:
- **OpenClaw:** `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md`, `USER.md`, `MEMORY.md`
- **Claude Code:** aggregated `CLAUDE.md`
- **Codex:** `AGENTS.md` as primary prompt
- **ClawTeam:** `team.toml` + `spawn-catalog.json` + per-agent prompt dirs

## 4. Find the right team entry point

Use the CLI to inspect what is installed:

```bash
malaclaw starter list
malaclaw starter suggest "research product idea"
malaclaw project list
malaclaw list
malaclaw project show my-project
malaclaw team show dev-company
malaclaw agent show pm
```

Each team has one `entry_point: true` agent. That agent is the normal front door for the team.

The 9 available packs and their entry points:

| Pack | Entry point | Best for |
|---|---|---|
| `dev-company` | `pm` | Software development projects |
| `content-factory` | `editor` | Content, publishing, media |
| `research-lab` | `research-lead` | Research, analysis, trend reports |
| `autonomous-startup` | varies | Full-stack product/ops autonomy |
| `personal-assistant` | `personal-assistant-lead` | Life admin, calendar, health, knowledge |
| `automation-ops` | `automation-lead` | Workflow automation, integrations, notifications |
| `customer-service` | `service-lead` | Multi-channel customer support |
| `finance-ops` | `finance-lead` | Market analysis, trading, risk management |
| `data-ops` | `data-lead` | Data pipelines, analytics, storage |

`malaclaw agent list` now shows both:

- store-managed agents installed by this repo
- available native OpenClaw agents discovered from `openclaw.json`

Examples:

- `dev-company` in project `my-project` -> `store__my-project__dev-company__pm`
- `content-factory` -> the Editor entry point
- `research-lab` -> the Research Lead entry point

If you want to reuse an existing native OpenClaw agent in a managed project instead of provisioning a full new team, attach it explicitly:

```bash
malaclaw project attach-agent ops
malaclaw install
```

This keeps ownership simple:

- OpenClaw owns the full runtime agent universe
- `malaclaw` owns store-managed teams and project-level attachment metadata
- `install` reconciles attached-agent skill placement

## 5. Give work to the entry-point agent

In OpenClaw, open the installed entry-point agent and give it the task directly.

Example:

```text
Build a landing page for our SaaS product.
Use React and Tailwind.
Need production-ready code, tests for core logic, and a short handoff summary.
```

The lead agent decides whether to spawn sub-agents and how to coordinate the work.

## 6. How agents coordinate

Store-managed agents do not talk to each other with direct peer messages.

They coordinate by:

- leads spawning sub-agents with `sessions_spawn`
- reading and writing shared memory files
- following the team graph, communication topology, and shared memory ownership rules

Each team has a **communication topology** that controls coordination patterns:

| Topology | How agents coordinate |
|---|---|
| **star** (default) | All tasks flow through the lead. Workers report only to the lead. |
| **lead-reviewer** | Tasks flow through lead. Workers may request review from designated reviewers. |
| **pipeline** | Tasks flow sequentially through stages. Each agent passes to the next. |
| **peer-mesh** | Agents may communicate with any other agent via shared memory. |

Topology is either declared explicitly in team YAML or auto-inferred from the delegation graph. Use `malaclaw team show <id>` to see the resolved topology. When a topology is incompatible with the target runtime, it is automatically downgraded to **star**.

This shared memory is an orchestration layer managed by `malaclaw`. It does not replace OpenClaw's native memory tools for each agent workspace.

In practice:

- talk to the team entry point for normal project work
- talk to a specific installed agent only if you intentionally want to bypass the team lead
- do not expect skills to be directly invokable as standalone agents

## 7. How skills work

Skills are installed into agent workspaces during `malaclaw install`.

Skill YAML in `templates/skills/*.yaml` is metadata for `malaclaw` to understand source, env requirements, and install hints. OpenClaw ultimately sees the installed skill folders inside workspaces, not the YAML metadata itself.

You do not open a skill directly in OpenClaw. Instead:

1. Add the skill to `malaclaw.yaml`
2. Ensure the target agent templates list that skill
3. Run `malaclaw install`
4. Talk to the agent or team entry point that has the skill available

### Declare-and-detect model

Each demo card (`demo-projects/cards/<id>.md`) includes a `## Skills Setup` section that lists:

- `project_skills`: skills the starter already places into the generated manifest — installed automatically
- `installable_skills`: OpenClaw skills the user may need to install or sync before attaching them
- `required_apis`: external APIs, SaaS integrations, or auth the user must configure
- `required_capabilities`: runtime/tool prerequisites such as `sessions_spawn`, Git, SSH, or filesystem access

When a user asks the `malaclaw-cook` skill to start a demo project, it reads the card, detects what is missing, explains each missing item, and guides the user through setup before initializing the project. Required skills and APIs block initialization. Optional skills are noted but do not block.

### Manual skill setup

For external skills or APIs without the manager skill:

1. Identify missing requirements from the demo card or skill template `install_hints`
2. Install or configure the external tool or API key
3. Optionally run `malaclaw skill sync` to refresh local availability
4. Re-run `malaclaw install`
5. Verify placement with `malaclaw skill check`

If a required environment variable is missing, the skill is installed as inactive. Project skills are not automatically attached to every agent — they are placed only where the agent template or project targets declare them.

You can target skills from `malaclaw.yaml`:

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

## 8. Add your own team

To create a custom team in this repo:

1. Add agent template files under `templates/agents/`
2. Add a team definition under `templates/teams/`
3. Add a pack definition under `packs/`
4. Run `npm run build`
5. Install it in a project with `malaclaw install --pack <your-pack-id>`

Minimum structure:

```text
templates/agents/my-lead-agent.yaml
templates/agents/my-specialist.yaml
templates/teams/my-team.yaml
packs/my-pack.yaml
```

Your team should usually have:

- exactly one entry-point lead
- `sessions_spawn: true` only on leads
- shared memory files with explicit `access` and `writer`

The runtime install path will be project-scoped even when the team template is reused:

```text
~/.malaclaw/workspaces/store/<project-id>/<team-id>/<agent-id>
```

## 9. Add your own skill

To create a custom skill in this repo:

1. Add `templates/skills/my-skill.yaml` following the `SkillEntry` schema
2. Reference it from the agent templates that should receive it (add to `skills:` list)
3. Add it to the project's `malaclaw.yaml`
4. Run `malaclaw install`

Minimum skill YAML structure:

```yaml
id: my-skill
version: 1
name: "My Skill"
description: "What this skill does"

source:
  type: clawhub
  url: "https://clawhub.ai/<developer>/my-skill"
  pin: "latest"

trust_tier: community

requires:
  bins: []                    # declare [] even if no binaries required — must come before env:
  env:
    - key: MY_API_KEY
      description: "API key for the service"
      required: true

disabled_until_configured: true

install_hints:
  - "Get your API key at https://example.com/api-keys"
  - "Set: export MY_API_KEY=..."
  - "Then re-run: malaclaw install"
```

If the skill needs environment variables, declare them in `requires.env` and set them before install. The `disabled_until_configured: true` flag marks the skill inactive until all required env vars are present, and `malaclaw doctor` will surface it.

## 10. Add more projects in the future

Each real project should have its own root directory and its own `malaclaw.yaml`.

To add another project:

1. Create or open the project directory
2. Either run `malaclaw starter init <id> <dir>` or `malaclaw init`
3. Select the team packs for that project
4. Add any required skills to that project's manifest
5. Run `malaclaw install`

Use `malaclaw project list` to see all installed projects across your machine.

If the project starts from a known pattern, prefer a starter:

```bash
malaclaw starter suggest "family assistant"
malaclaw starter init family-calendar-household-assistant ./family-hub
```

## 11. Configure which teams and skills a project should run

The project manifest is the control point.

Example:

```yaml
version: 1
project:
  id: podcast-studio
  name: "Podcast Studio"
  entry_team: content-factory
  attached_agents:
    - ops
packs:
  - id: content-factory
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

That means:

- the project is installed under the `podcast-studio` namespace
- it gets both the content and research teams
- the preferred entry team is `content-factory`
- it also attaches the existing native OpenClaw agent `ops` to the project
- agents that declare `github` or `last30days` receive those skills during install

If a skill targets `ops` by ID, `malaclaw install` places that skill into the native agent's workspace and updates its explicit allowlist if needed.

The same applies to native OpenClaw skills:

1. install/configure the skill in OpenClaw
2. run `malaclaw skill sync`
3. reference the skill ID in `malaclaw.yaml`
4. run `malaclaw install`

## 12. Turn a new idea into a managed project

The intended flow for `malaclaw-cook` is:

1. Search for a similar starter with `malaclaw starter suggest "<idea>"`
2. Inspect the closest match with `malaclaw starter show <id>`
3. Read `demo-projects/cards/<id>.md` when you need setup and execution guidance
4. Decide whether the default workflow is enough or whether to initialize the managed starter
5. Initialize it with `malaclaw starter init <id> <dir>`
6. Edit the generated `malaclaw.yaml`
7. Run `malaclaw install`

If no starter is a clean fit, use `default-managed` or the closest starter as scaffolding and modify the generated packs, skills, and targets.

## 13. Use the web dashboard

For a visual overview of projects, agents, skills, and health:

```bash
malaclaw dashboard
```

Opens http://localhost:3456 with four tabs: Overview, Projects, Starters, and Config.

The dashboard watches your project files and pushes real-time updates via WebSocket. You can browse starters and init projects directly from the UI.

The dashboard reads normalized agent telemetry from `~/.malaclaw/agents/<id>/state.json`, making it runtime-agnostic — it shows the same agent status view whether you're using OpenClaw, ClawTeam, or any other supported runtime.

For remote access options, see [docs/remote-access.md](./remote-access.md).

## 14. Agent telemetry

After install, `malaclaw` tracks agent status across all runtimes via normalized telemetry files.

Each agent has a `state.json` at `~/.malaclaw/agents/<agentId>/state.json` with:

- `status`: `idle`, `working`, `error`, or `offline`
- `runtime`: which runtime is executing
- `source`: how the telemetry was captured (`gateway`, `clawteam`, `heartbeat`, `manual`)
- `ttlSeconds`: after this period with no update, status auto-downgrades to `idle`

Two observer paths feed telemetry:

1. **OpenClaw:** Gateway WebSocket at `ws://localhost:18789`
2. **ClawTeam:** Reads native state from `~/.clawteam/teams/*/`

The dashboard and CLI read only the normalized files, so telemetry works identically regardless of runtime.

## 15. Typical workflow summary

```bash
# one-time setup in this repo
npm install
npm run build
npm link

# optional: begin from a demo starter
malaclaw starter suggest "podcast workflow"
malaclaw starter init podcast-production-pipeline ./my-project

# per project
cd my-project
malaclaw install
malaclaw doctor

# visual management
malaclaw dashboard

# inspect installed projects and available teams
malaclaw project list
malaclaw project show <project-id>
malaclaw list
malaclaw team show <team-id>

# then in OpenClaw
# open the project's entry-point agent and give it the task
```
