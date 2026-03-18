# Commands

## Bootstrap `malaclaw`

If the CLI is not available yet:

```bash
git clone https://github.com/gozhiyuan/MalaClaw
cd malaclaw
npm install
npm run build
npm link
malaclaw --help
malaclaw install
```

## Read state

```bash
malaclaw starter list
malaclaw starter show <starter-id>
malaclaw starter suggest "<idea>"
malaclaw project list
malaclaw project show <project-id>
malaclaw project status
malaclaw team show <team-id>          # shows topology, members, shared memory
malaclaw agent show <agent-id>
malaclaw skill show <skill-id>
malaclaw skill check
malaclaw skill sync
malaclaw diff
malaclaw doctor
malaclaw dashboard                    # web UI with runtime-agnostic telemetry
```

## Apply state

```bash
malaclaw starter init <starter-id> <dir>
malaclaw install
malaclaw install --force
```

Default lightweight managed entry point:

```bash
malaclaw starter show default-managed
malaclaw starter init default-managed ./my-project
```

Promotion flow from an existing ad hoc workflow:

```bash
malaclaw skill sync
malaclaw starter suggest "<current workflow>"
malaclaw starter init default-managed ./my-project
malaclaw install
```

Demo project metadata:

- `demo-projects/index.yaml`
- `demo-projects/cards/<starter-id>.md`

## Manifest patterns

### Runtime targeting

```yaml
version: 1
runtime: openclaw       # default — or claude-code, codex, clawteam
```

### Communication topology (in team YAML)

```yaml
communication:
  topology: star         # or lead-reviewer, pipeline, peer-mesh
  enforcement: advisory  # or strict
```

### Project-scoped skill targeting

```yaml
skills:
  - id: github
    targets:
      agents:
        - pm
        - tech-lead
```

```yaml
skills:
  - id: last30days
    targets:
      teams:
        - research-lab
```

### Project definition

```yaml
version: 1
runtime: clawteam
project:
  id: my-project
  name: "My Project"
  starter: podcast-production-pipeline
  entry_team: dev-company
```

### Starter-generated project with team-wide manager skill

```yaml
skills:
  - id: malaclaw-cook
    targets:
      teams:
        - content-factory
```

When an external skill is missing, guide the user to install or configure it in their runtime first, optionally run `malaclaw skill sync` to refresh availability, then re-run `malaclaw install` so the targeted agents receive it.

## Runtime compatibility quick reference

| Topology | Claude Code | Codex | OpenClaw | ClawTeam |
|---|---|---|---|---|
| star | native | native | native | native |
| lead-reviewer | downgrade→star | downgrade→star | native | native |
| pipeline | downgrade→star | downgrade→star | downgrade→star | native |
| peer-mesh | downgrade→star | downgrade→star | downgrade→star | native |

## Available teams

| Team | Entry point | Focus |
|---|---|---|
| dev-company | pm | Software development |
| content-factory | editor | Content, publishing, media |
| research-lab | research-lead | Research, analysis, reports |
| autonomous-startup | varies | Full-stack autonomy |
| personal-assistant | personal-assistant-lead | Life admin, calendar, health |
| automation-ops | automation-lead | Workflows, integrations |
| customer-service | service-lead | Multi-channel support |
| finance-ops | finance-lead | Markets, trading, risk |
| data-ops | data-lead | ETL, analytics, storage |
