# Contributing to MalaClaw

MalaClaw is the workflow/runtime layer. Contribute here when the change is
about generic orchestration rather than a specific writing product.

Good MalaClaw contributions include:

- workflow schema and validation,
- flow scheduling, retries, approvals, foreach, loop groups, state, logs,
- worker runtimes such as `codex`, `claude-code`, API runtimes, `script`,
- runtime capability checks, telemetry, cost/token reporting,
- dashboard host features that apply to every product,
- dashboard extension contracts and loader behavior,
- generic agent/team/pack templates.

Product-specific writing behavior belongs in LongWrite instead: research
providers, citation checks, novel bibles, book chapter contracts, manuscript
builders, writing scorecards, and the LongWrite dashboard tab.

## Local Setup

```bash
npm install
npm run build
npm test

cd dashboard
npm install
npm test
npm run build
cd ..
```

Use the built CLI directly while developing:

```bash
node dist/cli.js --help
node dist/cli.js flow runtimes
```

Or link it:

```bash
npm link
malaclaw --help
```

## Safe Smoke Tests

These checks do not spend model quota:

```bash
node dist/cli.js validate
node dist/cli.js flow runtimes
node dist/cli.js flow smoke-runtime --runtime dry-run --cleanup
npm run smoke:package
```

If you changed a real worker runtime and have the CLI logged in:

```bash
node dist/cli.js flow runtimes --runtime codex
node dist/cli.js flow smoke-runtime --runtime codex --cleanup

node dist/cli.js flow runtimes --runtime claude-code
node dist/cli.js flow smoke-runtime --runtime claude-code --cleanup
```

Real-runtime smoke tests may spend quota. Keep them small and say which account
runtime/model you used in the PR.

## Full Pre-PR Checklist

Run the same checks as CI:

```bash
npm ci
npx tsc --noEmit
npm test
npm run build
node dist/cli.js validate

cd dashboard
npm ci
npm test
npm run build
cd ..

npm pack --dry-run
npm run smoke:package
```

Expected current counts are roughly:

- root tests: 42 files, 332 passing, 1 skipped,
- dashboard tests: 7 files, 35 passing.

Counts may change as tests are added; failures should not be ignored.

## Dashboard Extension Boundary

The dashboard host is product-independent. Core dashboard code should not import
LongWrite routes, LongWrite config, or LongWrite UI directly.

Server extensions are loaded at runtime from trusted local modules:

```yaml
dashboard:
  server_extensions:
    - /path/to/product/dashboard-extension/dist/server/index.js
```

Client tabs are bundled at dashboard build time from known local product
checkouts. For alpha, this keeps packaging simple and avoids remote module
loading.

When changing extension behavior, update:

- `docs/dashboard-extensions.md`,
- `docs/repo-workflow.md`,
- package smoke coverage if package behavior changes.

## Worker Runtime Rules

Every runtime must declare capabilities through `checkAvailable()` so the engine
can reject incompatible stages before spending tokens.

Use these boundaries:

- `dry-run`: contract simulation only,
- `script`: deterministic commands with explicit `cmd` and `args`,
- API runtimes: one prompt, one concrete output, optional declared command tool
  where implemented,
- `codex` / `claude-code`: full CLI harnesses for multi-file/tool work.

If a runtime changes model, usage, cost, timeout, or quota behavior, update
`docs/workflow-runtime.md` and add or adjust tests.

## Template Contributions

For agents, teams, packs, and starters:

1. Add YAML under `templates/`, `packs/`, or `starters/`.
2. Keep IDs lowercase and stable.
3. Add enough description for `malaclaw starter list` and dashboard catalog use.
4. Run:

```bash
node dist/cli.js validate
npm test
```

OpenClaw remains a supported adapter, but new docs and templates should describe
MalaClaw as a workflow/runtime control plane first.

## Pull Request Notes

In the PR description, include:

- what runtime or workflow surface changed,
- whether the change can spend model quota,
- exact validation commands run,
- any known limitations or deferred work.
