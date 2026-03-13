import { z } from "zod";

// ── Capability model ─────────────────────────────────────────────────────────

export const CoordinationCapabilities = z.object({
  sessions_spawn: z.boolean().default(false),
  sessions_send: z.boolean().default(false),
});

export const FileAccessCapabilities = z.object({
  write: z.boolean().default(false),
  edit: z.boolean().default(false),
  apply_patch: z.boolean().default(false),
});

export const SystemCapabilities = z.object({
  exec: z.boolean().default(false),
  cron: z.boolean().default(false),
  gateway: z.boolean().default(false),
});

export const Capabilities = z.object({
  coordination: CoordinationCapabilities.default({}),
  file_access: FileAccessCapabilities.default({}),
  system: SystemCapabilities.default({}),
});

// ── Agent definition ─────────────────────────────────────────────────────────

export const AgentDef = z.object({
  id: z.string(),
  version: z.number().default(1),
  name: z.string(),

  identity: z
    .object({
      emoji: z.string().optional(),
      vibe: z.string().optional(),
    })
    .optional(),

  soul: z.object({
    persona: z.string(),
    tone: z.string().optional(),
    boundaries: z.array(z.string()).optional(),
  }),

  model: z.object({
    primary: z.string().default("claude-sonnet-4-5"),
    fallback: z.string().optional(),
  }),

  capabilities: Capabilities.default({}),

  skills: z.array(z.string()).optional(),

  memory: z
    .object({
      private_notes: z.string().optional(),
      shared_reads: z.array(z.string()).optional(),
    })
    .optional(),

  team_role: z
    .object({
      role: z.enum(["lead", "specialist", "reviewer"]),
      delegates_to: z.array(z.string()).optional(),
      reviews_for: z.array(z.string()).optional(),
    })
    .optional(),
});

export type AgentDef = z.infer<typeof AgentDef>;

// ── Team definition ──────────────────────────────────────────────────────────

export const TeamMember = z.object({
  agent: z.string(),
  role: z.enum(["lead", "specialist", "reviewer"]),
  entry_point: z.boolean().optional(),
});

export const GraphEdge = z.object({
  from: z.string(),
  to: z.string(),
  relationship: z.enum(["delegates_to", "requests_review"]),
});

export const SharedMemoryFile = z.object({
  path: z.string(),
  access: z.enum(["single-writer", "append-only", "private"]),
  writer: z.string(), // agent ID or "*"
});

export const TeamDef = z.object({
  id: z.string(),
  name: z.string().optional(),
  version: z.number().default(1),
  members: z.array(TeamMember),
  graph: z.array(GraphEdge).optional().default([]),
  shared_memory: z
    .object({
      dir: z.string(),
      files: z.array(SharedMemoryFile),
    })
    .optional(),
});

export type TeamDef = z.infer<typeof TeamDef>;
export type TeamMember = z.infer<typeof TeamMember>;
export type SharedMemoryFile = z.infer<typeof SharedMemoryFile>;

// ── Skill entry ──────────────────────────────────────────────────────────────

export const SkillEnvVar = z.object({
  key: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
  degradation: z.string().optional(),
});

export const SkillEntry = z.object({
  id: z.string(),
  version: z.number().default(1),
  name: z.string(),
  description: z.string().optional(),
  source: z.object({
    type: z.enum(["clawhub", "openclaw-bundled", "local"]),
    url: z.string().optional(),
    pin: z.string().optional(),
  }),
  trust_tier: z.enum(["curated", "community", "local"]),
  requires: z
    .object({
      bins: z.array(z.string()).optional(),
      env: z.array(SkillEnvVar).optional(),
    })
    .optional(),
  disabled_until_configured: z.boolean().default(false),
  install_hints: z.array(z.string()).optional(),
});

export type SkillEntry = z.infer<typeof SkillEntry>;

// ── Pack definition (packs/*.yaml) ──────────────────────────────────────────

export const PackDef = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string().optional(),
  teams: z.array(z.string()),
  default_skills: z.array(z.string()).optional(),
  compatibility: z
    .object({
      openclaw_min: z.string().optional(),
      openclaw_max: z.string().optional(),
      node_min: z.string().optional(),
    })
    .optional(),
});

export type PackDef = z.infer<typeof PackDef>;

// ── Project manifest (openclaw-store.yaml) ───────────────────────────────────

export const ManifestPackRef = z.object({
  id: z.string(),
  version: z.string().optional(),
  overrides: z.record(z.string()).optional(),
});

export const ManifestSkillRef = z.object({
  id: z.string(),
  env: z.record(z.enum(["required", "optional"])).optional(),
});

export const Manifest = z.object({
  version: z.number().default(1),
  packs: z.array(ManifestPackRef).optional().default([]),
  skills: z.array(ManifestSkillRef).optional().default([]),
});

export type Manifest = z.infer<typeof Manifest>;
export type ManifestPackRef = z.infer<typeof ManifestPackRef>;

// ── Lockfile (openclaw-store.lock) ───────────────────────────────────────────

export const LockedAgent = z.object({
  id: z.string(),
  workspace: z.string(),
  agent_dir: z.string(),
});

export const LockedPack = z.object({
  type: z.literal("pack"),
  id: z.string(),
  version: z.string(),
  checksum: z.string().optional(),
  agents: z.array(LockedAgent),
});

export const LockedSkill = z.object({
  type: z.literal("skill"),
  id: z.string(),
  version: z.string(),
  status: z.enum(["active", "inactive"]),
  missing_env: z.array(z.string()).optional(),
});

export const Lockfile = z.object({
  version: z.number().default(1),
  generated_at: z.string().optional(),
  packs: z.array(LockedPack).optional().default([]),
  skills: z.array(LockedSkill).optional().default([]),
});

export type Lockfile = z.infer<typeof Lockfile>;
export type LockedPack = z.infer<typeof LockedPack>;
export type LockedSkill = z.infer<typeof LockedSkill>;
export type LockedAgent = z.infer<typeof LockedAgent>;
