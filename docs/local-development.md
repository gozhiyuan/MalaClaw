# Local Development and Testing

This guide is the fastest way to verify that an updated `MalaClaw` checkout still builds, passes tests, and can bootstrap a real workflow.

## Prerequisites

- Node.js 22 or newer
- `npm`
- OpenClaw installed if you want to test the OpenClaw bootstrap path

## 1. Install dependencies and build the CLI

From the repo root:

```bash
cd MalaClaw
npm install
npm run build
```

This compiles the CLI to `dist/cli.js`.

## 2. Run the automated test suite

```bash
npm test
```

Optional:

```bash
npm run test:watch
npm run test:coverage
```

## 3. Smoke test the built CLI

Without linking globally:

```bash
node dist/cli.js --help
node dist/cli.js starter list
node dist/cli.js team show dev-company
node dist/cli.js validate
```

If you want `malaclaw` available as a shell command during testing:

```bash
npm link
malaclaw --help
malaclaw starter list
```

## 4. Safe install preview

If you want to confirm the install path without writing workspace files yet:

```bash
malaclaw install --dry-run
```

If you are testing from an existing project repo, run that command in the directory containing `malaclaw.yaml`.

## 5. Test the OpenClaw bootstrap path

Run this in a directory that does not contain `malaclaw.yaml`:

```bash
malaclaw install
```

This is a real install path. It writes to your OpenClaw setup, including `~/.openclaw/openclaw.json` and the main OpenClaw guidance files.

Expected behavior:

- `malaclaw` does zero-config bootstrap instead of failing
- it installs the bundled `malaclaw-cook` skill into the main OpenClaw workspace
- it updates the main OpenClaw guidance files

Use this path when you want to start from OpenClaw first and let the manager skill guide the rest.

## 6. Test a starter-based managed project

```bash
malaclaw starter suggest "podcast workflow"
malaclaw starter init podcast-production-pipeline ./tmp-podcast-project
cd ./tmp-podcast-project
malaclaw install
malaclaw doctor
```

What this verifies:

- starter discovery works
- project scaffolding writes `malaclaw.yaml`
- install can resolve the starter into managed workspaces
- `doctor` can validate the resulting setup

## 7. Test an existing repo promotion flow

Inside the repo you want to manage:

```bash
malaclaw init
malaclaw install --dry-run
malaclaw install
malaclaw project show <project-id>
```

This is the path for turning an existing ad hoc workflow into a managed project.

## 8. Test a different runtime adapter

Edit `malaclaw.yaml` and set:

```yaml
runtime: codex
```

or:

```yaml
runtime: clawteam
```

Then rerun:

```bash
malaclaw install
malaclaw doctor
```

This verifies that the same project manifest can compile to a different runtime target.

## Handy Commands

```bash
malaclaw diff
malaclaw doctor
malaclaw project list
malaclaw project show <id>
malaclaw agent list
malaclaw skill check
```

## Related Docs

- [./getting-started.md](./getting-started.md)
- [../README.md](../README.md)
- [./repo-workflow.md](./repo-workflow.md)
- [./how-it-works.md](./how-it-works.md)
