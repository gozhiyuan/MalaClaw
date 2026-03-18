import type { TeamDef, TopologyType } from "./schema.js";

/**
 * Infer topology from team graph edges.
 *
 * Classification rules:
 * 1. Empty graph or ≤1 member → star
 * 2. Has review edges from non-leads → lead-reviewer
 * 3. Each delegator delegates to exactly one node, forming a chain → pipeline
 * 4. Multiple nodes both delegate and receive delegation (cycle) → peer-mesh
 * 5. Default → star (hub-spoke / tree)
 */
export function inferTopology(team: TeamDef): TopologyType {
  const { graph, members } = team;
  if (!graph || graph.length === 0 || members.length <= 1) return "star";

  const delegationEdges = graph.filter((e) => e.relationship === "delegates_to");
  const reviewEdges = graph.filter((e) => e.relationship === "requests_review");

  // Build sets for analysis
  const delegators = new Set(delegationEdges.map((e) => e.from));
  const delegatees = new Set(delegationEdges.map((e) => e.to));
  const leads = new Set(members.filter((m) => m.role === "lead").map((m) => m.agent));

  // Check for peer-mesh: cycle in delegation graph (node is both delegator and delegatee)
  const delegateesWhoDelegateBack = [...delegatees].filter((d) => delegators.has(d));
  if (delegateesWhoDelegateBack.length > 0) {
    // Distinguish multi-level tree from cycle:
    // In a tree (dev-company), tech-lead receives from pm AND delegates to devs — but never back to pm.
    // Check for actual cycles.
    const hasCycle = detectCycle(delegationEdges);
    if (hasCycle) return "peer-mesh";
  }

  // Check for pipeline: linear chain where each node has at most 1 outgoing delegation
  // and the chain has length >= 2
  if (delegationEdges.length >= 2) {
    const outDegree = new Map<string, number>();
    const inDegree = new Map<string, number>();
    for (const e of delegationEdges) {
      outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
    const allOutOne = [...outDegree.values()].every((d) => d === 1);
    const allInOne = [...inDegree.values()].every((d) => d <= 1);
    if (allOutOne && allInOne && delegationEdges.length >= 2) {
      return "pipeline";
    }
  }

  // Check for lead-reviewer: non-lead agents have outgoing review edges
  if (reviewEdges.length > 0) {
    const nonLeadReviewers = reviewEdges.filter((e) => !leads.has(e.from));
    if (nonLeadReviewers.length > 0) return "lead-reviewer";
  }

  return "star";
}

/** Detect cycle in directed graph using DFS */
function detectCycle(edges: Array<{ from: string; to: string }>): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): boolean {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const neighbor of adj.get(node) ?? []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(node);
    return false;
  }

  for (const node of adj.keys()) {
    if (dfs(node)) return true;
  }
  return false;
}

/**
 * Resolve topology: use explicit declaration if present, otherwise infer from graph.
 */
export function resolveTopology(team: TeamDef): TopologyType {
  if (team.communication?.topology) return team.communication.topology;
  return inferTopology(team);
}

/**
 * Validate topology compatibility with a given runtime.
 *
 * Compatibility matrix:
 *   star:          all runtimes
 *   lead-reviewer: openclaw, clawteam
 *   pipeline:      clawteam only
 *   peer-mesh:     clawteam only
 */
export function validateTopologyForRuntime(
  topology: TopologyType,
  runtime: string,
): { valid: boolean; warning?: string; downgrade?: TopologyType } {
  const matrix: Record<TopologyType, string[]> = {
    star: ["openclaw", "claude-code", "codex", "clawteam"],
    "lead-reviewer": ["openclaw", "clawteam"],
    pipeline: ["clawteam"],
    "peer-mesh": ["clawteam"],
  };

  if (matrix[topology]?.includes(runtime)) {
    return { valid: true };
  }

  return {
    valid: false,
    warning: `Topology "${topology}" is not natively supported by runtime "${runtime}". Downgrading to "star". Agents will receive star-topology coordination instructions.`,
    downgrade: "star",
  };
}

/** Human-readable description of each topology type. */
export function getTopologyDescription(topology: TopologyType): string {
  const descriptions: Record<TopologyType, string> = {
    star: "All tasks flow through the lead. Workers report only to the lead. No direct worker-to-worker communication.",
    "lead-reviewer":
      "Tasks flow through the lead. Workers may request review from designated reviewers. Reviewers report findings back to the lead.",
    pipeline:
      "Tasks flow sequentially through pipeline stages. Each agent passes completed work to the next stage. Do not skip stages.",
    "peer-mesh":
      "Agents may communicate with any other agent in the team. All communication goes through shared memory files.",
  };
  return descriptions[topology];
}

/**
 * Get role-specific topology guidance for rendering into AGENTS.md.
 * Returns an array of markdown lines.
 */
export function getTopologyGuidance(topology: TopologyType, role: string): string[] {
  const lines: string[] = [];

  switch (topology) {
    case "star":
      if (role === "lead") {
        lines.push("- You are the **sole coordinator**. All workers report to you.");
        lines.push("- Workers do not communicate with each other directly.");
        lines.push("- Assign tasks via shared memory. Monitor progress in `tasks-log.md`.");
      } else {
        lines.push("- Report all progress and results **only to the lead**.");
        lines.push("- Do not communicate with other workers directly.");
        lines.push("- If you need input from another worker, ask the lead to coordinate.");
      }
      break;

    case "lead-reviewer":
      if (role === "lead") {
        lines.push("- You coordinate work and may request reviews.");
        lines.push("- Workers may also request review directly from designated reviewers.");
        lines.push("- Monitor `tasks-log.md` for review findings.");
      } else if (role === "reviewer") {
        lines.push("- You receive review requests from both the lead and specialists.");
        lines.push("- Report review findings by appending to `tasks-log.md`.");
        lines.push("- You do not assign or delegate tasks.");
      } else {
        lines.push("- Report progress to the lead.");
        lines.push("- You may request review directly from designated reviewers.");
        lines.push("- Do not communicate with other specialists directly.");
      }
      break;

    case "pipeline":
      lines.push("- Tasks flow through stages in order. You receive input from the previous stage.");
      lines.push("- When your stage is complete, hand off to the next stage via shared memory.");
      lines.push("- Do not skip stages or communicate out of order.");
      break;

    case "peer-mesh":
      lines.push("- You may communicate with **any** agent in the team via shared memory.");
      lines.push("- Check for updates from peers before starting new work.");
      lines.push("- Use `tasks-log.md` to coordinate and avoid duplicate effort.");
      break;
  }

  return lines;
}
