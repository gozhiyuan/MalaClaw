import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { runInstall } from "../src/commands/install.js";
import { loadLockfile } from "../src/lib/loader.js";

const envKeys = [
  "MALACLAW_DIR",
  "OPENCLAW_STATE_DIR",
  "HOME",
  "USERPROFILE",
] as const;

let tmpDir: string | null = null;
const originalEnv = new Map<string, string | undefined>();

afterEach(async () => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalEnv.clear();

  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("runInstall", () => {
  it("records failed skill installs in lockfile", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-install-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "malaclaw.yaml"),
      stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({ agents: { list: [] } }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.MALACLAW_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    await runInstall({ projectDir });

    const lockfile = await loadLockfile(projectDir);
    expect(lockfile).not.toBeNull();
    expect(lockfile?.project?.id).toBe("project");
    expect(lockfile?.skills.find((skill) => skill.id === "github")?.status).toBe("failed");
    expect(lockfile?.skills.find((skill) => skill.id === "github")?.install_error).toMatch(
      /Skill source not found/,
    );
    const runtime = JSON.parse(await fs.readFile(path.join(storeDir, "runtime.json"), "utf-8"));
    expect(runtime.projects).toHaveLength(1);
    expect(runtime.projects[0].id).toBe("project");
    expect(runtime.projects[0].entry_points[0].openclaw_agent_id).toBe("store__project__dev-company__pm");
  });

  it("installs targeted project skills into the requested agents", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-install-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "malaclaw.yaml"),
      stringify({
        version: 1,
        project: { id: "project", name: "Project" },
        packs: [{ id: "dev-company" }],
        skills: [{
          id: "malaclaw-cook",
          targets: { agents: ["pm"] },
        }],
      }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({ agents: { list: [] } }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.MALACLAW_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    await runInstall({ projectDir });

    await expect(
      fs.access(path.join(storeDir, "workspaces", "store", "project", "dev-company", "pm", "skills", "malaclaw-cook")),
    ).resolves.not.toThrow();
    await expect(
      fs.access(path.join(storeDir, "workspaces", "store", "project", "dev-company", "backend-dev", "skills", "malaclaw-cook")),
    ).rejects.toThrow();
  });

  it("preserves the implicit OpenClaw main agent when adding store-managed agents", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-install-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");
    const mainAgentDir = path.join(stateDir, "agents", "main", "agent");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(mainAgentDir, { recursive: true });
    await fs.writeFile(path.join(mainAgentDir, "models.json"), JSON.stringify({ providers: {} }));
    await fs.writeFile(path.join(mainAgentDir, "auth-profiles.json"), JSON.stringify({ version: 1, profiles: {} }));
    await fs.writeFile(
      path.join(projectDir, "malaclaw.yaml"),
      stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({
        agents: {
          defaults: {
            workspace: path.join(stateDir, "workspace"),
            model: { primary: "openai-codex/gpt-5.4" },
          },
        },
      }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.MALACLAW_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    await runInstall({ projectDir });

    const openclawConfig = JSON.parse(await fs.readFile(path.join(stateDir, "openclaw.json"), "utf-8"));
    const agentIds = openclawConfig.agents.list.map((entry: { id: string }) => entry.id);
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("store__project__dev-company__pm");
  });

  it("does not rewrite the main OpenClaw workspace guidance files during install", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-install-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");
    const mainAgentDir = path.join(stateDir, "agents", "main", "agent");
    const mainWorkspace = path.join(stateDir, "workspace");
    const originalTools = "# Custom TOOLS\n";
    const originalAgents = "# Custom AGENTS\n";

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(mainAgentDir, { recursive: true });
    await fs.mkdir(mainWorkspace, { recursive: true });
    await fs.writeFile(path.join(mainAgentDir, "models.json"), JSON.stringify({ providers: {} }));
    await fs.writeFile(path.join(mainAgentDir, "auth-profiles.json"), JSON.stringify({ version: 1, profiles: {} }));
    await fs.writeFile(path.join(mainWorkspace, "TOOLS.md"), originalTools);
    await fs.writeFile(path.join(mainWorkspace, "AGENTS.md"), originalAgents);
    await fs.writeFile(
      path.join(projectDir, "malaclaw.yaml"),
      stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({
        agents: {
          defaults: {
            workspace: mainWorkspace,
            model: { primary: "openai-codex/gpt-5.4" },
          },
        },
      }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.MALACLAW_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    await runInstall({ projectDir });

    await expect(fs.readFile(path.join(mainWorkspace, "TOOLS.md"), "utf-8")).resolves.toBe(originalTools);
    await expect(fs.readFile(path.join(mainWorkspace, "AGENTS.md"), "utf-8")).resolves.toBe(originalAgents);
  });

  it("installs targeted project skills into attached native OpenClaw agents", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-install-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");
    const nativeWorkspace = path.join(stateDir, "workspace-native");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(nativeWorkspace, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "malaclaw.yaml"),
      stringify({
        version: 1,
        project: {
          id: "project",
          name: "Project",
          attached_agents: ["ops"],
        },
        packs: [],
        skills: [{
          id: "malaclaw-cook",
          targets: { agents: ["ops"] },
        }],
      }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({
        agents: {
          list: [{
            id: "ops",
            name: "Ops",
            workspace: nativeWorkspace,
            agentDir: path.join(stateDir, "agents", "ops", "agent"),
            skills: [],
          }],
        },
      }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.MALACLAW_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    await runInstall({ projectDir });

    await expect(
      fs.access(path.join(nativeWorkspace, "skills", "malaclaw-cook")),
    ).resolves.not.toThrow();

    const openclawConfig = JSON.parse(await fs.readFile(path.join(stateDir, "openclaw.json"), "utf-8"));
    expect(openclawConfig.agents.list[0].skills).toContain("malaclaw-cook");

    const runtime = JSON.parse(await fs.readFile(path.join(storeDir, "runtime.json"), "utf-8"));
    expect(runtime.projects[0].attached_agents[0].id).toBe("ops");
    expect(runtime.projects[0].attached_agents[0].source).toBe("project-attached");
  });

  it("allows assignment of discovered native OpenClaw skills without a store template", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-install-"));
    const projectDir = path.join(tmpDir, "project");
    const storeDir = path.join(tmpDir, "store");
    const stateDir = path.join(tmpDir, "state");
    const homeDir = path.join(tmpDir, "home");
    const nativeWorkspace = path.join(stateDir, "workspace-native");
    const nativeSkillDir = path.join(homeDir, ".openclaw", "workspace", "skills", "native-skill");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(nativeWorkspace, { recursive: true });
    await fs.mkdir(nativeSkillDir, { recursive: true });
    await fs.writeFile(path.join(nativeSkillDir, "SKILL.md"), "# Native Skill\n");
    await fs.writeFile(
      path.join(projectDir, "malaclaw.yaml"),
      stringify({
        version: 1,
        project: {
          id: "project",
          attached_agents: ["ops"],
        },
        packs: [],
        skills: [{
          id: "native-skill",
          targets: { agents: ["ops"] },
        }],
      }),
    );
    await fs.writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({
        agents: {
          list: [{
            id: "ops",
            workspace: nativeWorkspace,
            agentDir: path.join(stateDir, "agents", "ops", "agent"),
            skills: [],
          }],
        },
      }),
    );

    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.MALACLAW_DIR = storeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    await runInstall({ projectDir });

    await expect(
      fs.access(path.join(nativeWorkspace, "skills", "native-skill")),
    ).resolves.not.toThrow();
    const openclawConfig = JSON.parse(await fs.readFile(path.join(stateDir, "openclaw.json"), "utf-8"));
    expect(openclawConfig.agents.list[0].skills).toContain("native-skill");
  });
});
