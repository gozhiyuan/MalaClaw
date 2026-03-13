#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("openclaw-store")
  .description("Starter packs, agent templates, and installer for OpenClaw")
  .version("1.0.0");

// ── init ─────────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Interactive wizard to create openclaw-store.yaml")
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
  .action(async (opts) => {
    const { listAll, listAgents, listTeams, listSkills, listPacks } = await import(
      "./commands/list.js"
    );
    if (opts.agents) return listAgents();
    if (opts.teams) return listTeams();
    if (opts.skills) return listSkills();
    if (opts.packs) return listPacks();
    return listAll();
  });

// ── install ───────────────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install packs from openclaw-store.yaml (or --pack for a one-shot install)")
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
    const { uninstallTeam, removeStoreGuidance } = await import(
      "./lib/adapters/openclaw.js"
    );
    const { loadLockfile } = await import("./lib/loader.js");
    const { resolveStoreWorkspacesRoot } = await import("./lib/paths.js");
    const path = await import("node:path");

    const lockfile = await loadLockfile();
    if (!lockfile) {
      console.log("Nothing to uninstall (no lockfile found).");
      return;
    }

    const packs = lockfile.packs ?? [];
    const toRemove = opts.all
      ? packs
      : packs.filter((p) => p.id === opts.pack);

    if (toRemove.length === 0) {
      console.log(opts.pack ? `Pack "${opts.pack}" not installed.` : "Nothing to uninstall.");
      return;
    }

    for (const pack of toRemove) {
      // Derive team ID from pack ID (convention: pack ID == team ID)
      const teamId = pack.id;
      const workspaceRoot = path.join(resolveStoreWorkspacesRoot(), teamId);
      console.log(`Uninstalling pack: ${pack.id}...`);
      await uninstallTeam(teamId, workspaceRoot);
      console.log(`✓ Uninstalled ${pack.id}`);
    }

    if (opts.all) {
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

// ── project ───────────────────────────────────────────────────────────────────

const projectCmd = program.command("project").description("Project management");

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

// ── doctor ────────────────────────────────────────────────────────────────────

program
  .command("doctor")
  .description("Health check: validate installation, env vars, and agent configs")
  .option("--fix", "Attempt to auto-fix issues")
  .action(async (opts) => {
    const { runDoctor } = await import("./commands/doctor.js");
    await runDoctor(opts.fix);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
