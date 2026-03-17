export type Project = {
  id: string;
  name: string;
  description?: string;
  project_dir: string;
  entry_team: string;
  packs: string[];
  skills: string[];
  entry_points: { team_id: string; agent_id: string; openclaw_agent_id: string; agent_name: string }[];
};

export type Agent = {
  id: string;
  name: string;
  identity?: { emoji?: string; vibe?: string };
  model?: { primary: string; fallback?: string };
  capabilities?: Record<string, unknown>;
  skills?: string[];
  team_role?: { role: string; delegates_to?: string[]; reviews_for?: string[] };
};

export type Team = {
  id: string;
  name: string;
  members: { agent: string; role: string; entry_point: boolean }[];
  graph?: { from: string; to: string; relationship: string }[];
  shared_memory?: { dir: string; files: { path: string; access: string; writer?: string }[] };
};

export type Skill = {
  id: string;
  name: string;
  description?: string;
  source?: { type: string; url?: string };
  trust_tier?: string;
};

export type SkillCheckResult = {
  id: string;
  status: "active" | "inactive" | "failed";
  missingEnv?: string[];
  installError?: string;
};

export type Finding = {
  check: string;
  severity: "ok" | "warning" | "error";
  message: string;
  fix?: string;
};

export type Starter = {
  id: string;
  name: string;
  description?: string;
  entry_team: string;
  packs: string[];
  tags?: string[];
  required_apis?: string[];
  required_capabilities?: string[];
  card?: string | null;
};

export type DiffEntry = {
  type: "added" | "removed" | "changed" | "unchanged";
  kind: "agent" | "skill";
  id: string;
  detail?: string;
};

export type WsEvent =
  | { type: "projects:changed" }
  | { type: "manifest:changed"; projectDir: string }
  | { type: "lockfile:changed"; projectDir: string }
  | { type: "skills:changed" }
  | { type: "memory:changed"; projectId: string; teamId: string; file: string }
  | { type: "install:progress"; phase: string; message: string; current?: number; total?: number };
