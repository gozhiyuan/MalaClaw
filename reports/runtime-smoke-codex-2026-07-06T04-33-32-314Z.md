# MalaClaw Runtime Smoke

Runtime: codex
Workspace: /var/folders/49/j40xv9x93fd67x6q8qbbphn40000gn/T/malaclaw-smoke-codex-QEGHFt
Available: yes
Headless: yes
Max concurrent: 2
Isolated workspace: no
Detail: codex-cli 0.142.5

## Result

Flow status: completed
Unit status: succeeded
Last outcome: success
Attempts: 1
Artifact smoke.md: present

## Events

- 2026-07-06T04:33:16.767Z flow_initialized
- 2026-07-06T04:33:16.802Z unit_started (smoke)
- 2026-07-06T04:33:32.311Z unit_succeeded (smoke)
- 2026-07-06T04:33:32.312Z flow_completed

## Known Failure Modes

- `rate_limited`: retry later or use another configured runtime.
- `quota_exhausted`: switch runtime/model or wait for quota reset.
- `permission_blocked`: adjust runtime permissions or move work to `script`.
- `model_unavailable`: choose a model supported by the selected runtime.
- `tool_missing`: this runtime cannot satisfy the stage shape.

