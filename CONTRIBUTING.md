# Contributing to openclaw-store

## Submitting a new agent, team, or pack

1. Fork this repo
2. Copy `templates/agents/_template.yaml` to `templates/agents/<your-id>.yaml`
3. Fill in all required fields (schema reference: `docs/how-it-works.md`)
4. Run `openclaw-store validate` — must pass with zero errors
5. Add a team or pack YAML that uses your agent (optional but recommended)
6. Add yourself to the `contributors/` directory (see `contributors/_template.md`)
7. Open a PR with title: `feat(template): add <your-agent-name>`

## Checklist before submitting

- [ ] `openclaw-store validate` passes
- [ ] `npm test` passes
- [ ] Agent has a realistic `soul.persona` with correct `{{variable}}` syntax
- [ ] Capabilities match the role (`sessions_spawn: false` for non-leads)
- [ ] All `shared_memory` files have explicit `access` and `writer` fields
- [ ] A `description` is provided in the pack YAML
- [ ] Trust tier is set correctly (`local` for personal, `community` for submissions)

## Trust tiers

| Tier | Requirements |
|---|---|
| `local` | User-owned, not reviewed |
| `community` | PR reviewed, schema valid, example included |
| `curated` | Maintainer-recommended, tested on multiple OpenClaw versions |
| `official` | Maintained by this repo |

## Running tests

```bash
npm install
npm test
npm run build
openclaw-store validate
```

## Compatibility policy

Each pack YAML should include a `compatibility` block declaring the minimum OpenClaw and Node versions it was tested with. CI will validate against the versions listed in `compatibility-matrix.yaml`.
