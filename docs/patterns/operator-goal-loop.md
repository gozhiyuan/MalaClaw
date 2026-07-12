# Operator Goals and Loops

MalaClaw owns the durable execution loop. Run `malaclaw flow supervise` in a
terminal, tmux session, service manager, or CI worker when a project should
wait through quota or transient runtime outages. It retries resumable blockers
with backoff and never approves a human gate.

`malaclaw flow operator-brief` is the provider-neutral observer interface. It
summarizes state, usage, the latest event, pending approvals, and any
supervisor schedule without changing the project.

## Claude Code loop or goal

Use a Claude Code loop or goal as a judgment and reporting layer, not as the
workflow engine. A suitable recurring instruction is:

```text
Every 30 minutes, run `malaclaw flow operator-brief` in <workspace>.
Report progress, blockers, score changes, and artifacts. Do not approve gates,
edit malaclaw.yaml, reset the flow, or start unrelated work.
```

The supervisor remains responsible for retries while Claude is unavailable.
The operator loop can resume observing after its own access returns.

## Codex App goal

Create a Codex goal with the same observer instruction. Codex `exec` is a
single worker invocation, not a durable scheduler, so use the MalaClaw
supervisor for actual waiting/retry behavior.

## Human gates

Only a person or an explicit dashboard/CLI action may approve:

```sh
malaclaw flow report
malaclaw flow approve <approval-id>
# or, after inspection:
malaclaw flow review --batch
```
