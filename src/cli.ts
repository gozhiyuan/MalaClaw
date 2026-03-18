#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("malaclaw")
  .description("Runtime-agnostic agent team templates and installer")
  .version("1.0.0");

// ── init ─────────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Interactive wizard to create malaclaw.yaml")
  .action(async () => {
    const { runInit } = await import("./commands/init.js");
    await runInit();
  });

// ── list ─────────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List available packs, agents, teams, or skills")
  .option("--agents", "List agent templates")
  .option("--teams", "List team templates")
  .option("--skills", "List skill templates")
  .option("--packs", "List pack definitions")
  .option("--starters", "List starter definitions")
  .action(async (opts) => {
    const { listAll, listAgents, listTeams, listSkills, listPacks } = await import(
      "./commands/list.js"
    );
    const { starterList } = await import("./commands/starter.js");
    if (opts.agents) return listAgents();
    if (opts.teams) return listTeams();
    if (opts.skills) return listSkills();
    if (opts.packs) return listPacks();
    if (opts.starters) return starterList();
    return listAll();
  });

// ── install ───────────────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install packs from malaclaw.yaml (or --pack for a one-shot install)")
  .option("--dry-run", "Preview changes without applying them")
  .option("--force", "Overwrite existing workspace files")
  .option("--pack <id>", "Install a specific pack without a manifest")
  .action(async (opts) => {
    const { runInstall } = await import("./commands/install.js");
    await runInstall({
      dryRun: opts.dryRun,
      force: opts.force,
      pack: opts.pack,
    });
  });

// ── uninstall ─────────────────────────────────────────────────────────────────

program
  .command("uninstall")
  .description("Uninstall installed packs")
  .option("--pack <id>", "Uninstall a specific pack")
  .option("--all", "Uninstall all installed packs")
  .action(async (opts) => {
    const { removeStoreGuidance } = await import("./lib/adapters/openclaw.js");
    const { getProvisioner } = await import("./lib/adapters/registry.js");
    const { loadLockfile, loadManifest } = await import("./lib/loader.js");
    const { resolveStoreWorkspacesRoot } = await import("./lib/paths.js");
    const { projectMetaFromLockfile } = await import("./lib/project-meta.js");
    const { removeRuntimeProject } = await import("./lib/runtime.js");
    const path = await import("node:path");

    const lockfile = await loadLockfile();
    if (!lockfile) {
      console.log("Nothing to uninstall (no lockfile found).");
      return;
    }

    // Detect runtime from manifest (fall back to openclaw)
    let runtime: "openclaw" | "claude-code" | "codex" | "clawteam" = "openclaw";
    try {
      const manifest = await loadManifest();
      runtime = manifest.runtime ?? "openclaw";
    } catch { /* no manifest, default to openclaw */ }
    const provisioner = getProvisioner(runtime);

    const packs = lockfile.packs ?? [];
    const project = projectMetaFromLockfile(lockfile);
    const deriveTeamId = (pack: typeof packs[number]): string => {
      if (pack.team_id) return pack.team_id;
      const firstAgentWorkspace = pack.agents[0]?.workspace;
      if (firstAgentWorkspace) {
        return path.basename(path.dirname(firstAgentWorkspace));
      }
      return pack.id.includes("__") ? pack.id.split("__").slice(1).join("__") : pack.id;
    };
    const deriveSourcePackId = (pack: typeof packs[number]): string => {
      if (pack.source_id) return pack.source_id;
      const teamId = deriveTeamId(pack);
      const suffix = `__${teamId}`;
      if (pack.id.endsWith(suffix)) {
        return pack.id.slice(0, -suffix.length);
      }
      return pack.id.includes("__") ? pack.id.split("__")[0] : pack.id;
    };
    const toRemove = opts.all
      ? packs
      : packs.filter((p) => p.id === opts.pack || deriveSourcePackId(p) === opts.pack);

    if (toRemove.length === 0) {
      console.log(opts.pack ? `Pack "${opts.pack}" not installed.` : "Nothing to uninstall.");
      return;
    }

    for (const pack of toRemove) {
      const firstAgentWorkspace = pack.agents[0]?.workspace;
      const workspaceRoot = firstAgentWorkspace
        ? path.dirname(firstAgentWorkspace)
        : path.join(resolveStoreWorkspacesRoot(), deriveTeamId(pack));
      const teamId = deriveTeamId(pack);
      console.log(`Uninstalling pack: ${pack.id}...`);
      await provisioner.uninstallTeam(project.id, teamId, workspaceRoot, pack.agents.map((a) => a.id));
      console.log(`✓ Uninstalled ${pack.id}`);
    }

    if (opts.all) {
      await removeRuntimeProject(project.id);
      console.log(`✓ Removed project registry entry: ${project.id}`);
    }

    if (opts.all && runtime === "openclaw") {
      await removeStoreGuidance();
      console.log("✓ Removed store guidance from main agent workspace.");
    }
  });

// ── agent ─────────────────────────────────────────────────────────────────────

const agentCmd = program
  .command("agent")
  .description("Manage installed agents");

agentCmd
  .command("list")
  .description("List installed (or available) agents")
  .action(async () => {
    const { agentList } = await import("./commands/agent.js");
    await agentList();
  });

agentCmd
  .command("show <id>")
  .description("Show details for an agent")
  .action(async (id: string) => {
    const { agentShow } = await import("./commands/agent.js");
    await agentShow(id);
  });

agentCmd
  .command("refresh <id>")
  .description("Re-render workspace files for an agent from its YAML template")
  .action(async (id: string) => {
    const { agentRefresh } = await import("./commands/agent.js");
    await agentRefresh(id);
  });

// ── team ──────────────────────────────────────────────────────────────────────

const teamCmd = program.command("team").description("Manage team templates");

teamCmd
  .command("list")
  .description("List all team templates")
  .action(async () => {
    const { teamList } = await import("./commands/team.js");
    await teamList();
  });

teamCmd
  .command("show <id>")
  .description("Show a team graph and shared memory config")
  .action(async (id: string) => {
    const { teamShow } = await import("./commands/team.js");
    await teamShow(id);
  });

// ── skill ─────────────────────────────────────────────────────────────────────

const skillCmd = program.command("skill").description("Manage skills");

skillCmd
  .command("list")
  .description("List available skills and their activation status")
  .action(async () => {
    const { skillList } = await import("./commands/skill.js");
    await skillList();
  });

skillCmd
  .command("show <id>")
  .description("Show skill details and env var status")
  .action(async (id: string) => {
    const { skillShow } = await import("./commands/skill.js");
    await skillShow(id);
  });

skillCmd
  .command("check")
  .description("Check activation status of all installed skills")
  .action(async () => {
    const { skillCheck } = await import("./commands/skill.js");
    await skillCheck();
  });

skillCmd
  .command("sync")
  .description("Discover OpenClaw-installed skills and sync availability inventory")
  .action(async () => {
    const { skillSync } = await import("./commands/skill.js");
    await skillSync();
  });

// ── project ───────────────────────────────────────────────────────────────────

const projectCmd = program.command("project").description("Project management");

projectCmd
  .command("list")
  .description("List installed projects from the runtime registry")
  .action(async () => {
    const { projectList } = await import("./commands/project.js");
    await projectList();
  });

projectCmd
  .command("show <id>")
  .description("Show runtime details for an installed project")
  .action(async (id: string) => {
    const { projectShow } = await import("./commands/project.js");
    await projectShow(id);
  });

projectCmd
  .command("status")
  .description("Show project installation status")
  .action(async () => {
    const { projectStatus } = await import("./commands/project.js");
    await projectStatus();
  });

projectCmd
  .command("kanban <team-id>")
  .description("Show the kanban board for a team")
  .action(async (teamId: string) => {
    const { projectKanban } = await import("./commands/project.js");
    await projectKanban(teamId);
  });

projectCmd
  .command("attach-agent <agent-id>")
  .description("Attach an existing native OpenClaw agent to the current project")
  .action(async (agentId: string) => {
    const { projectAttachAgent } = await import("./commands/project.js");
    await projectAttachAgent(agentId);
  });

projectCmd
  .command("detach-agent <agent-id>")
  .description("Detach a native OpenClaw agent from the current project")
  .action(async (agentId: string) => {
    const { projectDetachAgent } = await import("./commands/project.js");
    await projectDetachAgent(agentId);
  });

// ── starter ──────────────────────────────────────────────────────────────────

const starterCmd = program.command("starter").description("Manage starter demo projects");

starterCmd
  .command("list")
  .description("List starter definitions")
  .option("--search <query>", "Filter starters by query")
  .action(async (opts) => {
    const { starterList } = await import("./commands/starter.js");
    await starterList(opts.search);
  });

starterCmd
  .command("show <id>")
  .description("Show a starter definition")
  .action(async (id: string) => {
    const { starterShow } = await import("./commands/starter.js");
    await starterShow(id);
  });

starterCmd
  .command("suggest <query>")
  .description("Suggest starters similar to an idea")
  .action(async (query: string) => {
    const { starterSuggest } = await import("./commands/starter.js");
    await starterSuggest(query);
  });

starterCmd
  .command("init <id> [dir]")
  .description("Initialize a project from a starter")
  .option("--force", "Overwrite starter files if they already exist")
  .action(async (id: string, dir: string | undefined, opts) => {
    const { starterInit } = await import("./commands/starter.js");
    await starterInit(id, dir ?? process.cwd(), { force: opts.force });
  });

// ── diff ─────────────────────────────────────────────────────────────────────

program
  .command("diff")
  .description("Show what would change if you ran install against current lockfile")
  .action(async () => {
    const { runDiff } = await import("./commands/diff.js");
    await runDiff();
  });

// ── validate ─────────────────────────────────────────────────────────────────

program
  .command("validate")
  .description("Validate all templates against schema")
  .action(async () => {
    const { runValidate } = await import("./commands/validate.js");
    await runValidate();
  });

// ── doctor ────────────────────────────────────────────────────────────────────

program
  .command("doctor")
  .description("Health check: validate installation, env vars, and agent configs")
  .option("--fix", "Attempt to auto-fix issues")
  .action(async (opts) => {
    const { runDoctor } = await import("./commands/doctor.js");
    await runDoctor(opts.fix);
  });

// ── dashboard ────────────────────────────────────────────────────────────────

program
  .command("dashboard")
  .description("Start the web dashboard")
  .option("--port <port>", "Server port", "3456")
  .option("--host <host>", "Bind host", "0.0.0.0")
  .option("--auth-token <token>", "Bearer token for API authentication")
  .action(async (opts) => {
    const { runDashboard } = await import("./commands/dashboard.js");
    await runDashboard({ port: parseInt(opts.port), host: opts.host, authToken: opts.authToken });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
