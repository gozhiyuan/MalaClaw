# Getting Started

This guide starts with MalaClaw's current core: workflow execution. OpenClaw
bootstrap and starter installs are still supported, but they are adapter paths,
not the required first step.

## Prerequisites

- Node.js 22+
- npm
- Optional real workers:
  - Claude Code CLI, logged in, for `claude-code`
  - Codex CLI, logged in, for `codex`
  - local/OpenAI-compatible server for `openai-compatible` / `ollama`
  - API keys for hosted API runtimes:
    - `ANTHROPIC_API_KEY` or `MALACLAW_ANTHROPIC_API_KEY`
    - `GEMINI_API_KEY` / `GOOGLE_API_KEY` or `MALACLAW_GEMINI_API_KEY`
    - `MALACLAW_OPENAI_API_KEY` for hosted OpenAI-compatible endpoints

Start with `dry-run` and `script`; they do not require subscriptions, API keys,
or model quota. Use `codex` or `claude-code` for stages that need real harness
behavior such as multi-file edits, shell tools, skills, or build/debug loops.
Use API/local runtimes for cheaper single-output stages.

## 1. Build and Test

```bash
npm install
npm run build
npm test
```

If you want the dashboard from a source checkout:

```bash
cd dashboard
npm install
npm run build
npm test
cd ..
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
malaclaw flow runtimes --runtime anthropic-api
malaclaw flow runtimes --runtime gemini-api
malaclaw flow runtimes --runtime ollama
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

## 9. Optional: Dashboard

The dashboard is a generic MalaClaw host: it shows workflow state, approvals,
usage summaries, logs, and prompts. Product-specific tabs, such as LongWrite,
load through trusted local extensions.

```bash
malaclaw dashboard
```

To load LongWrite routes, configure the built LongWrite extension:

```yaml
# ~/.malaclaw/dashboard.yaml
dashboard:
  server_extensions:
    - /path/to/MrMaLiang/packages/longwrite/dashboard-extension/dist/server/index.js
```

Then check it:

```bash
malaclaw dashboard-extensions doctor
malaclaw dashboard
```

## Next: Run a LongWrite Flagship

MalaClaw is the generic workflow/runtime layer. LongWrite is its long-form
writing product layer: it compiles writing configuration into a MalaClaw flow,
then uses the same worker runtime, state, approval, validation, and supervision
mechanisms described above.

After completing the runtime check in this guide, follow LongWrite's Agentic
Survey Flagship Guide in the sibling MrMaLiang checkout for source-checkout
setup, a full research workspace, dashboard registration, optional API keys,
manual outline approval, quota supervision, and acceptance artifacts. It is
intentionally a product guide rather than a required MalaClaw dependency.

## 10. Contribute

Read [`../CONTRIBUTING.md`](../CONTRIBUTING.md). Contribute generic workflow
engine, runtime, dashboard host, schema, and template work to MalaClaw.
Contribute writing modes and manuscript-domain behavior to LongWrite.
