import { describe, it, expect } from "vitest";
import {
  inferTopology,
  resolveTopology,
  validateTopologyForRuntime,
  getTopologyDescription,
} from "../src/lib/topology.js";
import type { TeamDef } from "../src/lib/schema.js";

function makeTeam(overrides: Partial<TeamDef> = {}): TeamDef {
  return {
    id: "test",
    version: 1,
    members: [
      { agent: "lead", role: "lead", entry_point: true },
      { agent: "worker-1", role: "specialist" },
      { agent: "worker-2", role: "specialist" },
    ],
    graph: [],
    ...overrides,
  } as TeamDef;
}

describe("inferTopology", () => {
  it("returns star for empty graph", () => {
    expect(inferTopology(makeTeam())).toBe("star");
  });

  it("returns star for single-delegator hub (research-lab pattern)", () => {
    expect(
      inferTopology(
        makeTeam({
          graph: [
            { from: "lead", to: "worker-1", relationship: "delegates_to" },
            { from: "lead", to: "worker-2", relationship: "delegates_to" },
          ],
        }),
      ),
    ).toBe("star");
  });

  it("returns star for multi-level delegation (dev-company pattern)", () => {
    expect(
      inferTopology(
        makeTeam({
          members: [
            { agent: "pm", role: "lead", entry_point: true },
            { agent: "tech-lead", role: "lead" },
            { agent: "dev-1", role: "specialist" },
            { agent: "dev-2", role: "specialist" },
          ],
          graph: [
            { from: "pm", to: "tech-lead", relationship: "delegates_to" },
            { from: "tech-lead", to: "dev-1", relationship: "delegates_to" },
            { from: "tech-lead", to: "dev-2", relationship: "delegates_to" },
          ],
        }),
      ),
    ).toBe("star");
  });

  it("returns lead-reviewer when specialists have review edges", () => {
    expect(
      inferTopology(
        makeTeam({
          members: [
            { agent: "lead", role: "lead", entry_point: true },
            { agent: "worker", role: "specialist" },
            { agent: "reviewer", role: "reviewer" },
          ],
          graph: [
            { from: "lead", to: "worker", relationship: "delegates_to" },
            { from: "worker", to: "reviewer", relationship: "requests_review" },
            { from: "lead", to: "reviewer", relationship: "requests_review" },
          ],
        }),
      ),
    ).toBe("lead-reviewer");
  });

  it("returns pipeline for linear chain", () => {
    expect(
      inferTopology(
        makeTeam({
          members: [
            { agent: "stage-1", role: "lead", entry_point: true },
            { agent: "stage-2", role: "specialist" },
            { agent: "stage-3", role: "specialist" },
          ],
          graph: [
            { from: "stage-1", to: "stage-2", relationship: "delegates_to" },
            { from: "stage-2", to: "stage-3", relationship: "delegates_to" },
          ],
        }),
      ),
    ).toBe("pipeline");
  });

  it("returns peer-mesh for bidirectional delegation", () => {
    expect(
      inferTopology(
        makeTeam({
          graph: [
            { from: "lead", to: "worker-1", relationship: "delegates_to" },
            { from: "worker-1", to: "worker-2", relationship: "delegates_to" },
            { from: "worker-2", to: "lead", relationship: "delegates_to" },
          ],
        }),
      ),
    ).toBe("peer-mesh");
  });
});

describe("resolveTopology", () => {
  it("returns explicit topology when communication is set", () => {
    expect(
      resolveTopology(makeTeam({ communication: { topology: "pipeline", enforcement: "advisory" } })),
    ).toBe("pipeline");
  });

  it("infers topology when communication is omitted", () => {
    expect(resolveTopology(makeTeam())).toBe("star");
  });
});

describe("validateTopologyForRuntime", () => {
  it("star is valid for all runtimes", () => {
    for (const rt of ["openclaw", "claude-code", "codex", "clawteam"]) {
      expect(validateTopologyForRuntime("star", rt).valid).toBe(true);
    }
  });

  it("lead-reviewer is valid for openclaw and clawteam", () => {
    expect(validateTopologyForRuntime("lead-reviewer", "openclaw").valid).toBe(true);
    expect(validateTopologyForRuntime("lead-reviewer", "clawteam").valid).toBe(true);
  });

  it("lead-reviewer downgrades for claude-code", () => {
    const result = validateTopologyForRuntime("lead-reviewer", "claude-code");
    expect(result.valid).toBe(false);
    expect(result.downgrade).toBe("star");
    expect(result.warning).toBeDefined();
  });

  it("pipeline is only valid for clawteam", () => {
    expect(validateTopologyForRuntime("pipeline", "clawteam").valid).toBe(true);
    expect(validateTopologyForRuntime("pipeline", "claude-code").valid).toBe(false);
    expect(validateTopologyForRuntime("pipeline", "openclaw").valid).toBe(false);
  });

  it("peer-mesh is only valid for clawteam", () => {
    expect(validateTopologyForRuntime("peer-mesh", "clawteam").valid).toBe(true);
    expect(validateTopologyForRuntime("peer-mesh", "claude-code").valid).toBe(false);
  });
});

describe("getTopologyDescription", () => {
  it("returns non-empty description for all types", () => {
    for (const t of ["star", "lead-reviewer", "pipeline", "peer-mesh"] as const) {
      expect(getTopologyDescription(t).length).toBeGreaterThan(0);
    }
  });
});
