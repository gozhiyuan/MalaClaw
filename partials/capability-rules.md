# Capability Rules

## Coordination Capabilities

### sessions_spawn
- **Allowed for:** leads only
- **What it does:** Spawn a sub-agent to complete a delegated task
- **Usage:** The sub-agent completes and returns its result. No persistent back-channel.
- **Pattern:** Leads dispatch, specialists complete and report via memory files.

### sessions_send
- **Allowed for:** NOBODY — this capability is disabled for all agents
- **Why:** Direct peer-to-peer messaging creates race conditions and deadlocks
- **Alternative:** Write to append-only shared memory; the recipient reads it at next invocation

## File Capabilities

### write / edit / apply_patch
- Available to implementors (developers, writers, researchers)
- Reviewers do NOT have write access — they document findings, not implementations
- All writes to shared files must follow the access patterns in memory-conventions.md

## System Capabilities

### cron
- Only leads and project orchestrators may schedule cron jobs
- Specialists never create cron jobs

### exec
- Allowed for implementation specialists (developers, DevOps, analysts)
- Never use exec to modify shared infrastructure without review
