# Getting Started

This guide starts with MalaClaw's current core: workflow execution. OpenClaw
bootstrap and starter installs are still supported, but they are adapter paths,
not the required first step.

## Prerequisites

- Node.js 22+
- npm
- Optional real workers:
  - Claude Code for `claude-code`
  - Codex for `codex`
  - local/OpenAI-compatible server for `openai-compatible`

## 1. Build and Test

```bash
npm install
npm run build
npm test
```

Use the built CLI directly:

```bash
node dist/cli.js --help
```

Or link it:

```bash
npm link
malaclaw --help
```

## 2. Check Worker Runtimes

```bash
malaclaw flow runtimes
malaclaw flow runtimes --runtime codex
malaclaw flow runtimes --runtime claude-code
```

These checks do not spend model quota.

## 3. Run Runtime Smoke/Eval

Start with the free deterministic runtime:

```bash
malaclaw flow smoke-runtime --runtime dry-run --cleanup
```

Then try one real worker if available:

```bash
malaclaw flow smoke-runtime --runtime codex --cleanup
# or
malaclaw flow smoke-runtime --runtime claude-code --cleanup
```

Smoke reports are written to `reports/runtime-smoke-*.md`.

## 4. Create a Minimal Workflow Project

```bash
mkdir /tmp/malaclaw-mini
cd /tmp/malaclaw-mini
cat > malaclaw.yaml <<'YAML'
version: 1
runtime: codex
project:
  id: malaclaw-mini
  name: MalaClaw Mini
workflow:
  runtime_policy:
    primary: dry-run
  stages:
    - id: outline
      title: Outline
      owner: writer
      outputs:
        - outline.md
      validators:
        - required_output_exists
        - non_empty_markdown
      requires_human_approval: true
    - id: draft
      title: Draft
      owner: writer
      inputs:
        - outline.md
      outputs:
        - draft.md
      validators:
        - required_output_exists
        - non_empty_markdown
YAML
```

Run it:

```bash
malaclaw validate
malaclaw flow run --runtime dry-run
malaclaw flow report
malaclaw flow review --batch
malaclaw flow continue --runtime dry-run
malaclaw flow status
```

You should see a completed flow and generated artifacts.

## 5. Use a Real Worker

Change the second stage to a real runtime:

```yaml
    - id: draft
      title: Draft
      owner: writer
      runtime: codex
      inputs:
        - outline.md
      outputs:
        - draft.md
      validators:
        - required_output_exists
        - non_empty_markdown
```

Then reset and run:

```bash
malaclaw flow run --runtime dry-run --reset
malaclaw flow review --batch
malaclaw flow continue
```

The engine dispatches the `draft` stage to Codex because the stage sets
`runtime: codex`.

## 6. Optional: OpenAI-Compatible Local Runtime

For a local chat-completions-compatible server:

```bash
export MALACLAW_OPENAI_BASE_URL=http://127.0.0.1:11434/v1
export MALACLAW_OPENAI_MODEL=llama3.1
malaclaw flow runtimes --runtime openai-compatible
```

Use it for stages that write exactly one concrete output file:

```yaml
runtime: openai-compatible
outputs:
  - summary.md
```

For multi-file edits, use `codex`, `claude-code`, or `script`.

## 7. Optional: Install/Provision Team Workspaces

If you want MalaClaw to render team workspaces for a runtime:

```bash
malaclaw init
malaclaw install --dry-run
malaclaw install
malaclaw doctor
```

Top-level `runtime:` controls provisioning:

```yaml
runtime: openclaw      # patches OpenClaw
runtime: claude-code   # writes CLAUDE.md
runtime: codex         # writes AGENTS.md
runtime: clawteam      # writes team.toml + spawn catalog
```

## 8. Optional: Starter Catalog

```bash
malaclaw starter list
malaclaw starter suggest "podcast workflow"
malaclaw starter init podcast-production-pipeline ./my-podcast
cd ./my-podcast
malaclaw install --dry-run
```

Starters are still useful for provisioning examples, but LongWrite-style
workflow projects can also generate `malaclaw.yaml` directly.
