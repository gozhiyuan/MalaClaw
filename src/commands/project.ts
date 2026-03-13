import { loadLockfile } from "../lib/loader.js";
import { resolveSharedMemoryDir } from "../lib/paths.js";
import fs from "node:fs/promises";
import path from "node:path";

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function projectStatus(): Promise<void> {
  const lockfile = await loadLockfile();
  if (!lockfile) {
    console.log("No lockfile found. Run: openclaw-store install");
    return;
  }

  console.log("\nProject Status\n");
  console.log(`Packs installed: ${lockfile.packs?.length ?? 0}`);
  console.log(`Skills: ${lockfile.skills?.length ?? 0}`);

  for (const pack of lockfile.packs ?? []) {
    const activeSkills = lockfile.skills?.filter((s) => s.status === "active").length ?? 0;
    const inactiveSkills = lockfile.skills?.filter((s) => s.status === "inactive").length ?? 0;
    console.log(`\nPack: ${pack.id} (v${pack.version})`);
    console.log(`  Agents: ${pack.agents.length}`);
    for (const agent of pack.agents) {
      console.log(`    - ${agent.id}`);
    }
  }

  if ((lockfile.skills?.length ?? 0) > 0) {
    const active = lockfile.skills!.filter((s) => s.status === "active");
    const inactive = lockfile.skills!.filter((s) => s.status === "inactive");
    if (active.length > 0) {
      console.log(`\nActive skills: ${active.map((s) => s.id).join(", ")}`);
    }
    if (inactive.length > 0) {
      console.log(`Inactive skills: ${inactive.map((s) => s.id).join(", ")}`);
    }
  }
}

export async function projectKanban(teamId: string): Promise<void> {
  const kanbanPath = path.join(resolveSharedMemoryDir(teamId), "kanban.md");
  const content = await readFileOrEmpty(kanbanPath);

  if (!content) {
    console.log(`No kanban board found for team "${teamId}".`);
    console.log(`Expected: ${kanbanPath}`);
    return;
  }

  console.log(content);
}

export async function projectCreate(name: string): Promise<void> {
  // For v1: create a new openclaw-store.yaml in the current dir
  const { runInit } = await import("./init.js");
  console.log(`Creating project: ${name}`);
  await runInit();
}
