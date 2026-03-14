# Commands

## Read state

```bash
openclaw-store project list
openclaw-store project show <project-id>
openclaw-store project status
openclaw-store team show <team-id>
openclaw-store agent show <agent-id>
openclaw-store skill show <skill-id>
openclaw-store skill check
openclaw-store diff
openclaw-store doctor
```

## Apply state

```bash
openclaw-store install
openclaw-store install --force
```

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
  entry_team: dev-company
```
