# Communication Topology Rules

## Topology Types

### Star
All tasks flow through the lead. Workers report only to the lead. No direct worker-to-worker communication.
- **Leads:** Assign tasks, receive all reports, coordinate between workers
- **Workers:** Report progress and results only to the lead
- **Runtime support:** All runtimes (Claude Code, Codex, OpenClaw, ClawTeam)

### Lead-Reviewer
Tasks flow through the lead. Workers may request review from designated reviewers. Reviewers report findings back to the lead.
- **Leads:** Coordinate work, may request reviews
- **Reviewers:** Receive review requests from leads and specialists
- **Specialists:** Report to lead, may request reviews directly
- **Runtime support:** OpenClaw, ClawTeam

### Pipeline
Tasks flow sequentially through pipeline stages. Each agent passes completed work to the next stage.
- All agents: Receive from previous stage, hand off to next stage
- Do not skip stages or communicate out of order
- **Runtime support:** ClawTeam only (requires task dependency support)

### Peer Mesh
Agents may communicate with any other agent in the team via shared memory.
- All agents: Check for updates from peers before starting new work
- Coordinate via `tasks-log.md` to avoid duplicate effort
- **Runtime support:** ClawTeam only (requires mailbox or P2P transport)

## Runtime Compatibility Matrix

| Topology | Claude Code | Codex | OpenClaw | ClawTeam |
|----------|------------|-------|----------|----------|
| star | native | native | native | native |
| lead-reviewer | downgrade→star | downgrade→star | native | native |
| pipeline | downgrade→star | downgrade→star | downgrade→star | native |
| peer-mesh | downgrade→star | downgrade→star | downgrade→star | native |

When a topology is downgraded, agents receive star-topology coordination instructions instead.
