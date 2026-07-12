import { z } from "zod";
import { isSafeWorkspacePath, SAFE_ID_PATTERN } from "./workflow/safe-paths.js";

// Workflow ids become unit keys and filenames (prompts, blockers, checkpoints);
// artifact paths are joined with the workspace dir. Both must be path-safe.
const workflowId = z.string().regex(
  SAFE_ID_PATTERN,
  "must start alphanumeric and contain only letters, digits, _ or - (ids become filenames)",
);
const workspacePath = z.string().refine(
  isSafeWorkspacePath,
  "must be a relative path inside the workspace (no absolute paths or .. segments)",
);

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

export const TopologyType = z.enum(["star", "lead-reviewer", "pipeline", "peer-mesh"]);
export type TopologyType = z.infer<typeof TopologyType>;

export const CommunicationConfig = z.object({
  topology: TopologyType,
  enforcement: z.enum(["advisory", "strict"]).default("advisory"),
});
export type CommunicationConfig = z.infer<typeof CommunicationConfig>;

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
  communication: CommunicationConfig.optional(),
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

// ── Starter definition (starters/*.yaml) ────────────────────────────────────

export const StarterDef = z.object({
  id: z.string(),
  version: z.number().default(1),
  name: z.string(),
  description: z.string(),
  source_usecase: z.string(),
  source_path: z.string().optional(),
  entry_team: z.string(),
  packs: z.array(z.string()).default([]),
  project_skills: z.array(z.string()).default([]),
  installable_skills: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  required_apis: z.array(z.string()).default([]),
  required_capabilities: z.array(z.string()).default([]),
  external_requirements: z.array(z.string()).default([]),
  bootstrap_prompt: z.string().optional(),
});

export type StarterDef = z.infer<typeof StarterDef>;

// ── Demo project metadata (demo-projects/index.yaml) ───────────────────────

export const DemoProjectExecution = z.object({
  default_workflow: z.string(),
  managed_workflow: z.string(),
});

export const DemoProjectDef = z.object({
  id: z.string(),
  starter: z.string(),
  name: z.string(),
  summary: z.string(),
  category: z.string(),
  recommended_mode: z.enum(["default-workflow", "managed-team"]).default("managed-team"),
  source_usecase: z.string(),
  source_path: z.string().optional(),
  entry_team: z.string(),
  packs: z.array(z.string()).default([]),
  project_skills: z.array(z.string()).default([]),
  installable_skills: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  required_apis: z.array(z.string()).default([]),
  required_capabilities: z.array(z.string()).default([]),
  external_requirements: z.array(z.string()).default([]),
  setup_guidance: z.array(z.string()).default([]),
  card_path: z.string(),
  execution: DemoProjectExecution,
});

export const DemoProjectIndex = z.object({
  version: z.number().default(1),
  generated_at: z.string().optional(),
  demos: z.array(DemoProjectDef).default([]),
});

export type DemoProjectDef = z.infer<typeof DemoProjectDef>;
export type DemoProjectIndex = z.infer<typeof DemoProjectIndex>;

// ── Workflow definition (malaclaw.yaml workflow:) ───────────────────────────
// The parsed, default-applied WorkflowDef is the framework-neutral workflow IR.
// Execution semantics (engine, WorkerRuntime) arrive in a later milestone.
//
// These schemas are .strict() — unlike the rest of this file — because workflow
// YAML is user-edited and a silently-stripped typo (requiresHumanApproval,
// maxAttempts) could drop an approval gate. Fail closed on unknown keys.

export const WorkflowRetry = z
  .object({
    max_attempts: z.number().int().min(1).max(10).default(2),
  })
  .strict();

// Classified worker outcomes so the scheduler can act deterministically
// instead of treating every failure as a generic error.
export const StageRunOutcome = z.enum([
  "success",
  "validation_failed",
  "worker_error",
  "timeout",
  "rate_limited",
  "quota_exhausted",
  "permission_blocked",
  "tool_missing",
  "model_unavailable",
  "budget_exceeded",
]);

// A named model tier maps cheap/balanced/strong work to a runtime + model.
export const ModelTier = z
  .object({
    runtime: z.string().min(1),
    model: z.string().optional(),
    max_cost_usd: z.number().positive().optional(),
    requires_budget_approval: z.boolean().default(false),
  })
  .strict();

/** A quota fallback can name only a runtime (using that runtime's default
 * model), or pin the fallback provider's model explicitly. Keeping the model
 * with the fallback prevents a Claude model id from being passed to Codex. */
export const RuntimeFallbackCandidate = z.union([
  z.string().min(1),
  z.object({
    runtime: z.string().min(1),
    model: z.string().min(1).optional(),
  }).strict(),
]);

// Explicit runtime selection + failure policy. Fallback is never silent:
// the engine records requested vs actual runtime/model in state and events.
export const RuntimePolicy = z
  .object({
    primary: z.string().min(1).default("dry-run"),
    fallback: z.array(RuntimeFallbackCandidate).default([]),
    on_rate_limit: z.enum(["backoff", "fail"]).default("backoff"),
    on_quota_exhausted: z.enum(["try_fallback", "pause"]).default("pause"),
    on_budget_exceeded: z.enum(["require_approval", "pause"]).default("require_approval"),
  })
  .strict();

export const WorkflowCommand = z
  .object({
    cmd: z.string().min(1),
    args: z.array(z.string()).default([]),
  })
  .strict();

// Fields shared by normal stages and foreach inner steps.
const workUnitFields = {
  id: workflowId,
  title: z.string().optional(),
  owner: z.string().min(1),
  inputs: z.array(workspacePath).default([]),
  // Used if present, never required: exempt from the engine's input-existence
  // check (future milestone) and from input-provenance warnings.
  optional_inputs: z.array(workspacePath).default([]),
  outputs: z.array(workspacePath).default([]),
  // Advisory tool names mentioned in the stage prompt (any runtime).
  tools: z.array(z.string()).default([]),
  // Harness tool grants: maps to claude-code --allowedTools. Requires a
  // runtime with the cli_harness_tools capability.
  allowed_tools: z.array(z.string().min(1)).default([]),
  // Workspace-relative skill documents injected into the stage prompt.
  skills: z.array(workspacePath).default([]),
  // Non-negotiable, stage-local instructions. Keep these structured instead
  // of smuggling contracts into owner personas shared by unrelated stages.
  instructions: z.array(z.string().min(1)).default([]),
  validators: z.array(z.string()).default([]),
  validator_commands: z.array(WorkflowCommand).default([]),
  requires_human_approval: z.boolean().default(false),
  retry: WorkflowRetry.optional(),
  // Runtime/model selection overrides. Resolution order:
  // unit override -> model_tier -> workflow runtime_policy.primary.
  runtime: z.string().optional(),
  model: z.string().optional(),
  model_tier: z.string().optional(),
  command: WorkflowCommand.optional(),
};

// Inner step of a foreach item pipeline. Output paths may use {{item.id}}
// templates — opaque strings here, resolved by the engine.
export const WorkflowStep = z.object(workUnitFields).strict();

export const StandardStage = z
  .object({
    ...workUnitFields,
    type: z.literal("stage").optional(),
    max_rounds: z.number().int().min(1).optional(),
    stop_when: z.string().optional(),
  })
  .strict();

export const ForeachStage = z
  .object({
    type: z.literal("foreach"),
    id: workflowId,
    title: z.string().optional(),
    foreach: z.string().min(1), // path into an artifact, e.g. "outline.sections"
    item_name: z.string().default("item"),
    max_parallel: z.number().int().min(1).default(1),
    steps: z.array(WorkflowStep).min(1),
  })
  .strict()
  .superRefine((stage, ctx) => {
    const seen = new Set<string>();
    stage.steps.forEach((step, i) => {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "id"],
          message: `Duplicate step id "${step.id}"`,
        });
      }
      seen.add(step.id);
    });
  });

export const LoopStage = z
  .object({
    type: z.literal("loop"),
    id: workflowId,
    title: z.string().optional(),
    max_rounds: z.number().int().min(1),
    stop_when: z.string().optional(),
    stages: z.array(z.union([ForeachStage, StandardStage])).min(1),
  })
  .strict()
  .superRefine((stage, ctx) => {
    const seen = new Set<string>();
    stage.stages.forEach((child, i) => {
      if (seen.has(child.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", i, "id"],
          message: `Duplicate loop child stage id "${child.id}"`,
        });
      }
      seen.add(child.id);
    });
  });

// Not a discriminatedUnion: normal stages may omit `type`, and Zod v3
// discriminated unions require the discriminator on every member. ForeachStage
// is listed first but order does not affect correctness — strictness makes the
// two shapes mutually exclusive.
export const WorkflowStage = z.union([LoopStage, ForeachStage, StandardStage]);

/** Run guardrails: what THIS workflow may consume before pausing. These are
 *  not provider quotas (MalaClaw cannot observe subscription quota) and not
 *  exact caps — token totals are recorded after each unit finishes, so a cap
 *  can overshoot by one in-flight unit. The per-unit time cap bounds that. */
export const RunLimits = z
  .object({
    /** Pause before starting the next unit once recorded tokens reach this. */
    max_recorded_tokens: z.number().int().positive().optional(),
    /** Hard per-unit timeout (replaces the built-in 10-minute default). */
    max_unit_minutes: z.number().positive().optional(),
    /** Total active worker time across the run (excludes approval waits). */
    max_active_run_minutes: z.number().positive().optional(),
    /** Only pause is implemented; the field exists so intent is explicit. */
    on_limit: z.literal("pause").default("pause"),
  })
  .strict();

export const WorkflowDef = z
  .object({
    mode: z.string().optional(),
    artifact_type: z.string().optional(),
    // Artifacts supplied by the user or environment (expected to exist)
    // rather than produced by a stage — exempt from provenance warnings.
    external_inputs: z.array(workspacePath).default([]),
    // Global cap on concurrently running foreach items across the workflow.
    max_parallel: z.number().int().min(1).default(2),
    runtime_policy: RuntimePolicy.optional(),
    model_tiers: z.record(ModelTier).optional(),
    // Soft budget for the whole flow; enforcement arrives with real runtimes.
    budget_usd: z.number().positive().optional(),
    run_limits: RunLimits.optional(),
    stages: z.array(WorkflowStage).min(1),
  })
  .strict()
  .superRefine((wf, ctx) => {
    const seen = new Set<string>();
    wf.stages.forEach((stage, i) => {
      if (seen.has(stage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", i, "id"],
          message: `Duplicate stage id "${stage.id}"`,
        });
      }
      seen.add(stage.id);
    });
  });

export type WorkflowRetry = z.infer<typeof WorkflowRetry>;
export type StageRunOutcome = z.infer<typeof StageRunOutcome>;
export type ModelTier = z.infer<typeof ModelTier>;
export type RuntimeFallbackCandidate = z.infer<typeof RuntimeFallbackCandidate>;
export type RuntimePolicy = z.infer<typeof RuntimePolicy>;
export type WorkflowCommand = z.infer<typeof WorkflowCommand>;
export type WorkflowStep = z.infer<typeof WorkflowStep>;
export type StandardStage = z.infer<typeof StandardStage>;
export type ForeachStage = z.infer<typeof ForeachStage>;
export type LoopStage = z.infer<typeof LoopStage>;
export type RunLimits = z.infer<typeof RunLimits>;
export type WorkflowStage = z.infer<typeof WorkflowStage>;
export type WorkflowDef = z.infer<typeof WorkflowDef>;

// ── Project manifest (malaclaw.yaml) ───────────────────────────────────

export const ManifestProject = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  starter: z.string().optional(),
  entry_team: z.string().optional(),
  attached_agents: z.array(z.string()).optional(),
});

export const ManifestPackRef = z.object({
  id: z.string(),
  version: z.string().optional(),
  overrides: z.record(z.string()).optional(),
});

export const ManifestSkillRef = z.object({
  id: z.string(),
  env: z.record(z.enum(["required", "optional"])).optional(),
  targets: z.object({
    agents: z.array(z.string()).optional(),
    teams: z.array(z.string()).optional(),
  }).optional(),
});

export const RuntimeTarget = z.enum(["openclaw", "claude-code", "codex", "clawteam"]);
export type RuntimeTarget = z.infer<typeof RuntimeTarget>;

export const Manifest = z.object({
  version: z.number().default(1),
  runtime: RuntimeTarget.default("openclaw"),
  project: ManifestProject.optional(),
  packs: z.array(ManifestPackRef).optional().default([]),
  skills: z.array(ManifestSkillRef).optional().default([]),
  workflow: WorkflowDef.optional(),
});

export type Manifest = z.infer<typeof Manifest>;
export type ManifestPackRef = z.infer<typeof ManifestPackRef>;
export type ManifestProject = z.infer<typeof ManifestProject>;

// ── Lockfile (malaclaw.lock) ───────────────────────────────────────────

export const LockedProject = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  starter: z.string().optional(),
  entry_team: z.string().optional(),
  attached_agents: z.array(z.string()).optional(),
  project_dir: z.string().optional(),
});

export const LockedAgent = z.object({
  id: z.string(),
  workspace: z.string(),
  agent_dir: z.string(),
});

export const LockedPack = z.object({
  type: z.literal("pack"),
  id: z.string(),
  project_id: z.string().optional(),
  source_id: z.string().optional(),
  team_id: z.string().optional(),
  version: z.string(),
  checksum: z.string().optional(),
  agents: z.array(LockedAgent),
});

export const LockedSkill = z.object({
  type: z.literal("skill"),
  id: z.string(),
  version: z.string(),
  status: z.enum(["active", "inactive", "failed"]),
  missing_env: z.array(z.string()).optional(),
  install_error: z.string().optional(),
});

export const Lockfile = z.object({
  version: z.number().default(1),
  generated_at: z.string().optional(),
  project: LockedProject.optional(),
  packs: z.array(LockedPack).optional().default([]),
  skills: z.array(LockedSkill).optional().default([]),
});

export type Lockfile = z.infer<typeof Lockfile>;
export type LockedProject = z.infer<typeof LockedProject>;
export type LockedPack = z.infer<typeof LockedPack>;
export type LockedSkill = z.infer<typeof LockedSkill>;
export type LockedAgent = z.infer<typeof LockedAgent>;

// ── Runtime registry (~/.malaclaw/runtime.json) ───────────────────────

export const RuntimeEntryPoint = z.object({
  team_id: z.string(),
  agent_id: z.string(),
  openclaw_agent_id: z.string(),
  agent_name: z.string().optional(),
});

export const RuntimeAttachedAgent = z.object({
  id: z.string(),
  name: z.string().optional(),
  workspace: z.string().optional(),
  agent_dir: z.string().optional(),
  source: z.enum(["project-attached", "openclaw-native", "store-managed"]),
});

export const RuntimeProject = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  starter: z.string().optional(),
  entry_team: z.string().optional(),
  project_dir: z.string(),
  manifest_path: z.string().optional(),
  lockfile_path: z.string().optional(),
  packs: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  entry_points: z.array(RuntimeEntryPoint).default([]),
  attached_agents: z.array(RuntimeAttachedAgent).default([]),
  updated_at: z.string(),
});

export const RuntimeState = z.object({
  version: z.number().default(1),
  projects: z.array(RuntimeProject).default([]),
});

export type RuntimeEntryPoint = z.infer<typeof RuntimeEntryPoint>;
export type RuntimeAttachedAgent = z.infer<typeof RuntimeAttachedAgent>;
export type RuntimeProject = z.infer<typeof RuntimeProject>;
export type RuntimeState = z.infer<typeof RuntimeState>;

// ── Skill inventory (~/.malaclaw/skills-index.json) ───────────────────

export const DiscoveredSkill = z.object({
  id: z.string(),
  name: z.string().optional(),
  source: z.enum(["template", "openclaw-workspace", "openclaw-global", "store-cache"]),
  path: z.string(),
  version: z.string().optional(),
  managed_by_store: z.boolean().default(false),
});

export const SkillInventory = z.object({
  version: z.number().default(1),
  updated_at: z.string().optional(),
  skills: z.array(DiscoveredSkill).default([]),
});

export type DiscoveredSkill = z.infer<typeof DiscoveredSkill>;
export type SkillInventory = z.infer<typeof SkillInventory>;

/* ── Runtime & Telemetry ─────────────────────────────── */

export const AgentTelemetry = z.object({
  agentId: z.string(),
  runtime: RuntimeTarget,
  status: z.enum(["idle", "working", "error", "offline"]),
  detail: z.string().optional(),
  updatedAt: z.string(),               // ISO 8601
  sessionId: z.string().optional(),
  pid: z.number().optional(),
  workspaceDir: z.string().optional(),
  lastHeartbeatAt: z.string().optional(), // ISO 8601
  ttlSeconds: z.number().default(300),
  source: z.enum(["gateway", "clawteam", "heartbeat", "manual"]).default("manual"),
});
export type AgentTelemetry = z.infer<typeof AgentTelemetry>;
