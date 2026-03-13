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
  .option("--no-openclaw", "Skip openclaw.json patching (use with Claude Code or CI)")
  .action(async (opts) => {
    const { runInstall } = await import("./commands/install.js");
    await runInstall({
      dryRun: opts.dryRun,
      force: opts.force,
      pack: opts.pack,
      noOpenclaw: opts.openclaw === false,  // commander inverts --no-* flags
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
      // pack.id is "packId__teamId" — derive workspace root from first agent if available
      const firstAgentWorkspace = pack.agents[0]?.workspace;
      const workspaceRoot = firstAgentWorkspace
        ? path.dirname(firstAgentWorkspace)  // parent of agent workspace = team workspace root
        : path.join(resolveStoreWorkspacesRoot(), deriveTeamId(pack));
      const teamId = deriveTeamId(pack);
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

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
