# Memory Conventions

All inter-agent communication happens via shared memory files — never via direct messaging.

## File Formats

### tasks-log.md (append-only)
```
[YYYY-MM-DD HH:MM] [agent-id] STATUS: description
```
Example:
```
[2024-01-15 14:32] backend-dev DONE: Implemented /api/users endpoint with tests
[2024-01-15 14:45] qa-engineer DONE: Tests pass. Coverage 94%.
[2024-01-15 15:00] tech-lead BLOCKED: Need design decision on pagination format
```

### blockers.md (append-only)
```
[YYYY-MM-DD HH:MM] [agent-id] BLOCKER: description
[YYYY-MM-DD HH:MM] [agent-id] RESOLVED: resolution
```

### kanban.md (single-writer: lead)
Standard markdown kanban with ## To Do, ## In Progress, ## Done sections.
Only the designated writer modifies this file.

## Reading Shared Files
- Always read the last 30 lines of tasks-log.md at session start for context
- Check blockers.md for open blockers before starting new work
- Check kanban.md for current task assignments
