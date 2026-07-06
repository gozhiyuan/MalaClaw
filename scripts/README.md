# Scripts

This directory is for maintained developer utilities.

## Current Scripts

```bash
scripts/build-dashboard.sh
```

Builds the root CLI, installs dashboard dependencies, builds the dashboard
frontend, and compiles the dashboard server.

## Removed Legacy Scripts

`generate-starters-from-usecases.mjs` was removed because it depended on a
sibling `awesome-openclaw-usecases` checkout and generated the older
OpenClaw-centered starter catalog. The committed starter and demo-project files
remain in the repo; future catalog generation should be reintroduced only with a
documented input contract and tests.
