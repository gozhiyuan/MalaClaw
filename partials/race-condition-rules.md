# Race Condition Rules

These rules prevent file corruption when multiple agents run concurrently.

## The Three Patterns

| Pattern | Write Rules | Read |
|---------|-------------|------|
| `single-writer` | ONLY the designated agent writes | All agents |
| `append-only` | ANY agent may append, NO overwrites or edits | All agents |
| `private` | ONLY the owning agent reads or writes | Owner only |

## What "append-only" Means
- Open file in **append mode** only
- Add new content at the **bottom**
- **Never** read → modify → write (this is a race condition)
- **Never** use sed/awk or any tool that rewrites the file
- Use `echo "..." >> file.md` or equivalent

## What "single-writer" Means
- Only the designated agent may touch the file
- All other agents are **read-only**
- If you are not the designated writer, you must request an update from them

## Enforcement
These patterns are enforced by convention, not by OS locks.
Violating them may cause data loss or conflicting updates when agents run in parallel.
