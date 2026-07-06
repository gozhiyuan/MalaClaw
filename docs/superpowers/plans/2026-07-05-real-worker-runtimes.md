# Real Worker Runtimes: claude-code + codex (Milestone 7 core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `malaclaw flow run --runtime claude-code` (or `codex`) executes stages through the real agent CLIs, headless and fail-closed, with worker output captured to logs, cost/usage recorded, and CLI failures classified into the engine's outcome states (`rate_limited`, `quota_exhausted`, `permission_blocked`, `model_unavailable`, `timeout`, `worker_error`).

**Architecture:** A shared `runSubprocess()` helper (extracted from `ScriptRuntime`) does spawn/timeout/log-capture. Each runtime builds its CLI invocation, feeds the rendered stage contract via **stdin** (arg-length safe), parses structured output where available (`claude -p --output-format json` → cost/usage/is_error), classifies failures by pattern, and reports `producedFiles` by checking the declared concrete outputs on disk. Both runtimes accept an `argsOverride`/`bin` option so unit tests run against stub binaries (`process.execPath -e …`) — no API keys in CI; a gated integration test (`MALACLAW_REAL_RUNTIME_TESTS=1`) exercises the real CLIs.

Fail-closed permissions (per spec): claude-code runs `-p` with `--permission-mode acceptEdits` and an explicit `--allowedTools` list (default `Read,Write,Edit,Glob,Grep,Bash`) — in print mode, undeclared tool permissions are denied, not prompted. Codex runs `exec --sandbox workspace-write` (non-interactive by design). Exact flags are current as of 2026-07; `args`/`argsOverride` options are the escape hatch if CLIs change.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/lib/workflow/runtimes/subprocess.ts` | Create | `runSubprocess({bin,args,cwd,stdinText,timeoutMs,env,logPath})` → `{code,output,timedOut}` + log write |
| `src/lib/workflow/runtimes/classify.ts` | Create | `classifyCliFailure(text)` → outcome; `collectProducedFiles(workspaceDir, outputs)` |
| `src/lib/workflow/runtimes/script.ts` | Modify | Reuse `runSubprocess` (behavior unchanged) |
| `src/lib/workflow/runtimes/claude-code.ts` | Create | `ClaudeCodeRuntime` |
| `src/lib/workflow/runtimes/codex.ts` | Create | `CodexRuntime` |
| `src/lib/workflow/runtimes/registry.ts` | Modify | Register both |
| `tests/real-runtimes.test.ts` | Create | Stub-binary unit tests + gated real integration test |
| `README.md` / `CLAUDE.md` | Modify | Runtime table |

Classification patterns (first match wins, case-insensitive): `rate.?limit|429|overloaded` → `rate_limited`; `quota|credit balance|billing|usage limit` → `quota_exhausted`; `permission.*(denied|required)|not allowed to use` → `permission_blocked`; `model.*(not found|unavailable|invalid)` → `model_unavailable`; else `worker_error`.

---

### Task 1: subprocess helper + classify module (+ ScriptRuntime refactor)

- [ ] Extract spawn/timeout/log logic into `runSubprocess`; `ScriptRuntime.runStage` becomes a thin wrapper (its env-var contract unchanged). All existing tests stay green.
- [ ] `classify.ts` with the pattern table + `collectProducedFiles` (fs-check concrete outputs via `resolveWithin`, unsafe → skipped).
- [ ] Unit tests for both (stub commands via `process.execPath -e`). Commit.

### Task 2: ClaudeCodeRuntime

- [ ] `checkAvailable()`: run `<bin> --version` (5s timeout) → `{available, supports_headless: true, max_concurrent: 2, requires_isolated_workspace: false, detail}`.
- [ ] `runStage()`: args `["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools", allowed.join(","), ...(model ? ["--model", model] : []), ...extraArgs]` (or `argsOverride` verbatim); stdin = instructions; cwd = workspace; log to `req.logPath ?? .malaclaw/flow/logs/<unitKey>.log`.
- [ ] Result: timeout → `timeout`; exit 0 → try parse trailing JSON (`is_error` true → classify; else `success` + `usage {input_tokens, output_tokens, cost_usd: total_cost_usd}`); nonzero → classify output text. `producedFiles` from `collectProducedFiles`.
- [ ] Stub tests: success JSON with usage; stub that writes `plan.md` (producedFiles); 429 text → `rate_limited`; usage-limit text → `quota_exhausted`; sleep > timeoutMs → `timeout`; `checkAvailable` against `process.execPath`. Commit.

### Task 3: CodexRuntime

- [ ] Same shape: `checkAvailable` via `--version`; args `["exec", "--sandbox", "workspace-write", ...(model ? ["-m", model] : []), ...extraArgs, "-"]` with stdin prompt; plain-text output; exit 0 → `success`, else classify. Stub tests mirror Task 2 (minus JSON parsing). Commit.

### Task 4: Registry + gated integration + docs

- [ ] Register both in `registry.ts`. `it.runIf(process.env.MALACLAW_REAL_RUNTIME_TESTS === "1")` integration test: real `claude -p` runs a one-stage flow writing `hello.md`.
- [ ] README runtime table + CLAUDE.md note. Full `npm run build && npm test`. Commit.

## Out of Scope

- Runtime fallback chains / `on_quota_exhausted: try_fallback` dispatch (needs policy plumbing; blocker-pause already handles it safely).
- Budget enforcement from recorded `cost_usd` (recorded now; enforced later).
- Direct API / local (Ollama) runtimes.
- Isolated per-item workspaces.
