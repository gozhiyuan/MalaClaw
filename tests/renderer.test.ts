import { describe, it, expect } from "vitest";
import { renderSoul, renderTools, renderAgentsFile } from "../src/lib/renderer.js";
import { AgentDef, TeamDef } from "../src/lib/schema.js";

const makeAgent = (overrides: Partial<AgentDef> = {}): AgentDef =>
  AgentDef.parse({
    id: "test-lead",
    name: "Test Lead",
    identity: { emoji: "🧪", vibe: "precise and helpful" },
    soul: {
      persona: "You are {{agent.name}} on the {{team.name}} team.",
      tone: "Direct",
      boundaries: ["Never lie"],
    },
    model: { primary: "claude-sonnet-4-5" },
    capabilities: {
      coordination: { sessions_spawn: true, sessions_send: false },
      file_access: { write: true, edit: true, apply_patch: false },
      system: { exec: false, cron: false, gateway: false },
    },
    team_role: { role: "lead", delegates_to: ["test-specialist"] },
    ...overrides,
  });

const makeTeam = (): TeamDef =>
  TeamDef.parse({
    id: "test-team",
    name: "Test Team",
    members: [
      { agent: "test-lead", role: "lead", entry_point: true },
      { agent: "test-specialist", role: "specialist" },
    ],
    shared_memory: {
      dir: "~/.openclaw-store/workspaces/store/test-team/shared/memory/",
      files: [
        { path: "tasks-log.md", access: "append-only", writer: "*" },
        { path: "brief.md", access: "single-writer", writer: "test-lead" },
      ],
    },
  });

describe("renderSoul", () => {
  it("substitutes {{agent.name}} and {{team.name}}", () => {
    const soul = renderSoul({ agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead", entry_point: true } });
    expect(soul).toContain("You are Test Lead on the Test Team team.");
    expect(soul).not.toContain("{{agent.name}}");
    expect(soul).not.toContain("{{team.name}}");
  });

  it("includes boundaries as bullet list", () => {
    const soul = renderSoul({ agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead" } });
    expect(soul).toContain("- Never lie");
  });
});

describe("renderTools", () => {
  it("shows sessions_spawn as enabled for lead", () => {
    const tools = renderTools({ agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead" } });
    expect(tools).toContain("**sessions_spawn** (orchestrate sub-agents): ✓ enabled");
  });

  it("shows sessions_send as disabled always", () => {
    const tools = renderTools({ agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead" } });
    expect(tools).toContain("**sessions_send** (direct peer messaging): ✗ disabled");
  });
});

describe("renderAgentsFile", () => {
  it("marks current agent with YOU arrow", () => {
    const specialist = AgentDef.parse({
      id: "test-specialist",
      name: "Test Specialist",
      soul: { persona: "You are {{agent.name}}." },
      model: { primary: "claude-haiku-4-5" },
      capabilities: {},
      team_role: { role: "specialist" },
    });
    const allMembers = [
      { member: { agent: "test-lead", role: "lead" as const, entry_point: true }, agent: makeAgent() },
      { member: { agent: "test-specialist", role: "specialist" as const }, agent: specialist },
    ];
    const agentsFile = renderAgentsFile(
      { agent: specialist, team: makeTeam(), member: { agent: "test-specialist", role: "specialist" } },
      allMembers,
    );
    expect(agentsFile).toContain("← **YOU**");
  });

  it("shows single-writer access as WRITE for the designated writer", () => {
    const agentsFile = renderAgentsFile(
      { agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead", entry_point: true } },
      [{ member: { agent: "test-lead", role: "lead" as const, entry_point: true }, agent: makeAgent() }],
    );
    expect(agentsFile).toContain("**WRITE** (you are the sole writer)");
  });

  it("shows single-writer access as read only for non-writers", () => {
    const specialist = AgentDef.parse({
      id: "test-specialist",
      name: "Test Specialist",
      soul: { persona: "spec" },
      model: { primary: "claude-haiku-4-5" },
      capabilities: {},
    });
    const agentsFile = renderAgentsFile(
      { agent: specialist, team: makeTeam(), member: { agent: "test-specialist", role: "specialist" } },
      [{ member: { agent: "test-specialist", role: "specialist" as const }, agent: specialist }],
    );
    expect(agentsFile).toContain("read only");
  });
});
