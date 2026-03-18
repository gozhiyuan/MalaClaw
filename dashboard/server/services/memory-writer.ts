import fs from "node:fs/promises";
import path from "node:path";

// Import from dist/lib/ following the store bridge pattern
import { resolveSharedMemoryDir } from "../../../dist/lib/paths.js";
import { loadTeam } from "../../../dist/lib/loader.js";

interface WriteKanbanOpts {
  projectId: string;
  teamId: string;
  content: string;
  requestingAgent: string;
}

export class MemoryWriter {
  async writeKanban(opts: WriteKanbanOpts): Promise<void> {
    const { projectId, teamId, content, requestingAgent } = opts;

    // Load team to check ownership rules
    let team;
    try {
      team = await loadTeam(teamId);
    } catch {
      // If team can't be loaded, allow dashboard writes (graceful degradation)
      if (requestingAgent !== "dashboard") {
        throw new Error("Ownership check failed: team not found");
      }
    }

    // Check ownership rules if team loaded
    if (team?.shared_memory?.files) {
      const kanbanFile = team.shared_memory.files.find(
        (f) => f.path === "kanban.md" || f.path.endsWith("/kanban.md")
      );
      if (kanbanFile) {
        const access = kanbanFile.access ?? "";
        const writer = kanbanFile.writer ?? "";

        // single-writer must match
        if (access.startsWith("single-writer:")) {
          const allowedWriter = access.replace("single-writer:", "").trim();
          if (requestingAgent !== allowedWriter && requestingAgent !== "dashboard") {
            throw new Error(
              `Ownership violation: kanban.md is single-writer for "${allowedWriter}", ` +
              `but "${requestingAgent}" attempted to write`
            );
          }
        }
        // private files cannot be written by dashboard
        if (access.startsWith("private:") && requestingAgent === "dashboard") {
          throw new Error("Ownership violation: cannot write to private memory files from dashboard");
        }
      }
    }

    // Write atomically: temp file + rename
    const dir = resolveSharedMemoryDir(projectId, teamId);
    const filePath = path.join(dir, "kanban.md");
    const tmpPath = filePath + ".tmp." + Date.now();

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  async writeBlockers(opts: Omit<WriteKanbanOpts, "content"> & { content: string }): Promise<void> {
    const { projectId, teamId, content } = opts;
    const dir = resolveSharedMemoryDir(projectId, teamId);
    const filePath = path.join(dir, "blockers.md");
    const tmpPath = filePath + ".tmp." + Date.now();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, filePath);
  }
}
