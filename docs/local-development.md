# Local Development

Use this checklist after changing MalaClaw.

## Build and Test

```bash
npm install
npm run build
npm test
```

If your system Node is too old, use a Node 22 runtime.

## Safe CLI Smoke

These commands avoid provider cost and avoid writing OpenClaw config:

```bash
node dist/cli.js --help
node dist/cli.js validate
node dist/cli.js flow runtimes
node dist/cli.js flow smoke-runtime --runtime dry-run --cleanup
```

If Codex or Claude Code is installed and quota is available:

```bash
node dist/cli.js flow runtimes --runtime codex
node dist/cli.js flow smoke-runtime --runtime codex --cleanup

node dist/cli.js flow runtimes --runtime claude-code
node dist/cli.js flow smoke-runtime --runtime claude-code --cleanup
```

Smoke reports are written under `reports/`.

## Workflow Fixture Smoke

Create a temporary project:

```bash
tmp=$(mktemp -d /tmp/malaclaw-dev-XXXXXX)
cd "$tmp"
cat > malaclaw.yaml <<'YAML'
version: 1
project:
  id: dev-smoke
workflow:
  stages:
    - id: plan
      owner: lead
      outputs: [plan.md]
      validators: [required_output_exists, non_empty_markdown]
YAML

node /path/to/MalaClaw/dist/cli.js validate
node /path/to/MalaClaw/dist/cli.js flow run --runtime dry-run
node /path/to/MalaClaw/dist/cli.js flow status
```

## Optional Provisioning Checks

These exercise the install/provisioning surface:

```bash
node dist/cli.js starter list
node dist/cli.js starter init podcast-production-pipeline /tmp/malaclaw-podcast
cd /tmp/malaclaw-podcast
node /path/to/MalaClaw/dist/cli.js install --dry-run
```

Only run a real OpenClaw install when you intentionally want to write
`~/.openclaw/openclaw.json`:

```bash
node /path/to/MalaClaw/dist/cli.js install
```

## Dashboard

```bash
scripts/build-dashboard.sh
node dist/cli.js dashboard
```

Open `http://localhost:3456`.

## Documentation Checks

After changing public docs:

```bash
rg -n "OpenClaw bootstrap|installer|workflow runtime|WorkerRuntime" README.md docs
rg -n "generate-starters-from-usecases|awesome-openclaw-usecases" README.md docs scripts
```

OpenClaw should be described as an adapter path. The workflow engine should be
the primary project scope.
