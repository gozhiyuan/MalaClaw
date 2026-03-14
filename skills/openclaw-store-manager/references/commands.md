# Commands

## Read state

```bash
openclaw-store starter list
openclaw-store starter show <starter-id>
openclaw-store starter suggest "<idea>"
openclaw-store project list
openclaw-store project show <project-id>
openclaw-store project status
openclaw-store team show <team-id>
openclaw-store agent show <agent-id>
openclaw-store skill show <skill-id>
openclaw-store skill check
openclaw-store skill sync
openclaw-store diff
openclaw-store doctor
```

## Apply state

```bash
openclaw-store starter init <starter-id> <dir>
openclaw-store install
openclaw-store install --force
```

Default lightweight managed entry point:

```bash
openclaw-store starter show default-managed
openclaw-store starter init default-managed ./my-project
```

Demo project metadata:

- `demo-projects/index.yaml`
- `demo-projects/cards/<starter-id>.md`

## Manifest patterns

Project-scoped skill targeting:

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

Project definition:

```yaml
project:
  id: my-project
  name: "My Project"
  starter: podcast-production-pipeline
  entry_team: dev-company
```

Starter-generated project with team-wide manager skill:

```yaml
skills:
  - id: openclaw-store-manager
    targets:
      teams:
        - content-factory
```

When an external skill is missing, guide the user to install or configure it in OpenClaw first, optionally run `openclaw-store skill sync` to refresh availability, then re-run `openclaw-store install` so the targeted agents receive it.

## New Teams (v1.1.0)

| Pack | Entry agent | Use for |
|---|---|---|
| `personal-assistant` | `personal-assistant-lead` | Habit tracking, health, calendar, meetings, CRM, second brain |
| `automation-ops` | `automation-lead` | Email, workflows, notifications, n8n, phone calls, Todoist |
| `customer-service` | `service-lead` | Multi-channel customer support and ticket management |
| `finance-ops` | `finance-lead` | Earnings tracking, Polymarket, market research |
| `data-ops` | `data-lead` | Dashboards, RAG/knowledge base, semantic search |
