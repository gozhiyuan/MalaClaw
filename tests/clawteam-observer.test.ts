import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClawTeamObserver, readClawTeamState } from "../src/lib/adapters/clawteam.js";

let tmpDir: string | null = null;
const originalEnv = process.env.CLAWTEAM_DATA_DIR;
const originalMalaclaw = process.env.MALACLAW_DIR;

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.CLAWTEAM_DATA_DIR;
  else process.env.CLAWTEAM_DATA_DIR = originalEnv;
  if (originalMalaclaw === undefined) delete process.env.MALACLAW_DIR;
  else process.env.MALACLAW_DIR = originalMalaclaw;
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

async function setupClawTeamFixture(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawteam-test-"));
  process.env.CLAWTEAM_DATA_DIR = tmpDir;

  const teamDir = path.join(tmpDir, "teams", "test-team");
  await fs.mkdir(teamDir, { recursive: true });
  await fs.writeFile(path.join(teamDir, "config.json"), JSON.stringify({
    name: "test-team",
    description: "Test team",
    leadAgentId: "abc123",
    createdAt: "2026-03-17T10:00:00Z",
    members: [
      { name: "leader", user: "test", agentId: "abc123", agentType: "lead", joinedAt: "2026-03-17T10:00:00Z" },
      { name: "worker-1", user: "test", agentId: "def456", agentType: "researcher", joinedAt: "2026-03-17T10:01:00Z" },
    ],
  }));

  await fs.writeFile(path.join(teamDir, "spawn_registry.json"), JSON.stringify({
    leader: { backend: "tmux", tmux_target: "sess:0", pid: 99999, command: ["claude"] },
    "worker-1": { backend: "subprocess", tmux_target: "", pid: 99998, command: ["codex"] },
  }));

  const taskDir = path.join(tmpDir, "tasks", "test-team");
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, "task-001.json"), JSON.stringify({
    id: "001", subject: "Research market trends", status: "in_progress",
    owner: "worker-1", createdAt: "2026-03-17T10:05:00Z", updatedAt: "2026-03-17T10:10:00Z",
  }));
  await fs.writeFile(path.join(taskDir, "task-002.json"), JSON.stringify({
    id: "002", subject: "Write report", status: "pending",
    owner: "leader", blockedBy: ["001"], createdAt: "2026-03-17T10:05:00Z", updatedAt: "2026-03-17T10:05:00Z",
  }));

  return tmpDir;
}

describe("readClawTeamState", () => {
  it("reads team config, members, and tasks", async () => {
    await setupClawTeamFixture();
    const state = await readClawTeamState("test-team");
    expect(state).not.toBeNull();
    expect(state!.team.name).toBe("test-team");
    expect(state!.members).toHaveLength(2);
    expect(state!.tasks).toHaveLength(2);
  });

  it("returns null for nonexistent team", async () => {
    await setupClawTeamFixture();
    const state = await readClawTeamState("nonexistent");
    expect(state).toBeNull();
  });
});

describe("ClawTeamObserver", () => {
  it("implements RuntimeObserver with runtime='clawteam'", () => {
    const o = new ClawTeamObserver("clawteam");
    expect(o.runtime).toBe("clawteam");
    expect(typeof o.start).toBe("function");
    expect(typeof o.stop).toBe("function");
    expect(typeof o.getAgentStatuses).toBe("function");
  });

  it("returns normalized telemetry from ClawTeam state", async () => {
    await setupClawTeamFixture();
    const malDir = path.join(tmpDir!, "malaclaw");
    process.env.MALACLAW_DIR = malDir;

    const o = new ClawTeamObserver("clawteam");
    await o.syncTeamState("test-team");

    const statuses = await o.getAgentStatuses();
    expect(statuses.length).toBeGreaterThanOrEqual(2);

    const workerStatus = statuses.find((s) => s.agentId.includes("worker-1"));
    expect(workerStatus).toBeDefined();
    expect(workerStatus!.source).toBe("clawteam");
  });
});
