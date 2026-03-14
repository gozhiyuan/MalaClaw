import os from "node:os";
import path from "node:path";

// ── OpenClaw core paths (unchanged by this tool) ────────────────────────────

export function resolveOpenClawStateDir(): string {
  const env = process.env.OPENCLAW_STATE_DIR?.trim();
  if (env) return env;
  return path.join(os.homedir(), ".openclaw");
}

export function resolveOpenClawConfigPath(): string {
  const env = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (env) return env;
  return path.join(resolveOpenClawStateDir(), "openclaw.json");
}

export function resolveMainAgentWorkspaceDir(): string {
  return path.join(resolveOpenClawStateDir(), "workspace");
}

// ── openclaw-store runtime paths (~/.openclaw-store/) ───────────────────────

export function resolveStoreRoot(): string {
  const env = process.env.OPENCLAW_STORE_DIR?.trim();
  if (env) return env;
  return path.join(os.homedir(), ".openclaw-store");
}

export function resolveStoreCacheDir(): string {
  return path.join(resolveStoreRoot(), "cache", "packs");
}

export function resolveStoreWorkspacesRoot(): string {
  return path.join(resolveStoreRoot(), "workspaces", "store");
}

export function resolveProjectWorkspaceRoot(projectId: string): string {
  return path.join(resolveStoreWorkspacesRoot(), projectId);
}

/** Workspace dir for a specific agent within a team pack */
export function resolveAgentWorkspaceDir(projectId: string, teamId: string, agentId: string): string {
  return path.join(resolveProjectWorkspaceRoot(projectId), teamId, agentId);
}

/** Shared memory dir for a team */
export function resolveSharedMemoryDir(projectId: string, teamId: string): string {
  return path.join(resolveProjectWorkspaceRoot(projectId), teamId, "shared", "memory");
}

export function resolveStoreRuntimeFile(): string {
  return path.join(resolveStoreRoot(), "runtime.json");
}

// ── Project-local paths (git-committed) ─────────────────────────────────────

export function resolveManifestPath(projectDir: string = process.cwd()): string {
  return path.join(projectDir, "openclaw-store.yaml");
}

export function resolveLockfilePath(projectDir: string = process.cwd()): string {
  return path.join(projectDir, "openclaw-store.lock");
}

// ── Template paths (bundled with openclaw-store) ────────────────────────────

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveTemplatesRoot(): string {
  const env = process.env.OPENCLAW_STORE_BUNDLED_TEMPLATES?.trim();
  if (env) return env;
  // src/lib/paths.ts → ../../templates
  return path.resolve(__dirname, "..", "..", "templates");
}

export function resolveBundledSkillsRoot(): string {
  return path.resolve(__dirname, "..", "..", "skills");
}

export function resolveAgentTemplatesDir(): string {
  return path.join(resolveTemplatesRoot(), "agents");
}

export function resolveTeamTemplatesDir(): string {
  return path.join(resolveTemplatesRoot(), "teams");
}

export function resolveSkillTemplatesDir(): string {
  return path.join(resolveTemplatesRoot(), "skills");
}

export function resolvePacksDir(): string {
  const env = process.env.OPENCLAW_STORE_PACKS_DIR?.trim();
  if (env) return env;
  return path.resolve(__dirname, "..", "..", "packs");
}

export function resolvePartialsDir(): string {
  return path.resolve(__dirname, "..", "..", "partials");
}

/** Custom templates overlay directory (via env var or project-local ./templates) */
export function resolveOverlayTemplatesDir(): string | null {
  const env = process.env.OPENCLAW_STORE_TEMPLATES?.trim();
  if (env) return env;
  // Check project-local ./templates (if it differs from bundled)
  const local = path.join(process.cwd(), "templates");
  // Don't treat the repo itself as an overlay
  if (local !== resolveTemplatesRoot()) return local;
  return null;
}

// ── OpenClaw agent dirs (agent/ entry used by OpenClaw) ─────────────────────

/** The openclaw agent directory for a store-managed agent */
export function resolveOpenClawAgentDir(projectId: string, teamId: string, agentId: string): string {
  const safeId = `store__${projectId}__${teamId}__${agentId}`.replace(/[^a-zA-Z0-9_-]/g, "__");
  return path.join(resolveOpenClawStateDir(), "agents", safeId, "agent");
}

/** Canonical agent ID as registered in openclaw.json */
export function resolveAgentId(projectId: string, teamId: string, agentId: string): string {
  return `store__${projectId}__${teamId}__${agentId}`;
}
