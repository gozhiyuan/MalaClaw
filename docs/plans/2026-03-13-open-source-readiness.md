# openclaw-app-store: Open Source Readiness Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Elevate openclaw-app-store from a working v1 prototype to a production-grade, open-source-ready platform across three phases — ending with a community pack catalog, dashboard, and AI-assisted configuration.

**Architecture:** Three-phase progression: Phase 1 stabilises the core install engine (tests, real skill install, multi-team packs, diff/apply, local overlays); Phase 2 adds a web dashboard, remote pack sources, and AI-assisted generation; Phase 3 introduces community catalog workflows, structured task backends, and Claude Code export. All state is project-local YAML — the CLI is the single source of truth.

**Tech Stack:** TypeScript (NodeNext ESM), Zod, yaml, commander, @clack/prompts, vitest (tests), Node ≥ 22

---

## Current Limitations (confirmed)

| Issue | Location | Impact |
|---|---|---|
| Pack resolver takes only `teams[0]` | `src/lib/resolver.ts:65` | Multi-team packs silently drop extra teams |
| Skills report status, not installed | `src/commands/install.ts:88-100` | Skills are never fetched or linked to agents |
| `openclaw.json` entry only has id/name/model/workspace/agentDir | `src/lib/adapters/openclaw.ts:99` | Capability policy is prompt-only, not config-enforced |
| No tests | entire repo | Regressions are invisible |
| Claude Code adapter is stub | `src/lib/adapters/claude-code.ts:26` | No Claude Code support |

---

## Phase 1 — Core Engine (Open Source Baseline)

Scope: Everything needed to publish a stable, tested, community-contributable v1.0.

**Tasks: 1–12**

---

### Task 1: Test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/helpers/fixtures.ts`
- Modify: `package.json` (add vitest dev dep, `test` script)

**Step 1: Install vitest**

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

**Step 2: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

**Step 3: Add test script to package.json**

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

**Step 4: Create test helpers**

```typescript
// tests/helpers/fixtures.ts
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
export const TEMPLATES_DIR = path.resolve(__dirname, "../../templates");
export const PACKS_DIR    = path.resolve(__dirname, "../../packs");
```

**Step 5: Run (no tests yet — should exit 0)**

```bash
npm test
```

Expected: `No test files found`

**Step 6: Commit**

```bash
git add vitest.config.ts tests/ package.json package-lock.json
git commit -m "chore: add vitest test infrastructure"
```

---

### Task 2: Schema validation — parse all bundled YAMLs

**Files:**
- Create: `tests/schema.test.ts`

**Step 1: Write failing tests (will fail if any bundled YAML is malformed)**

```typescript
// tests/schema.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { AgentDef, TeamDef, SkillEntry, PackDef } from "../src/lib/schema.js";
import { TEMPLATES_DIR, PACKS_DIR } from "./helpers/fixtures.js";

async function listYamls(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir);
  return entries.filter((e) => e.endsWith(".yaml")).map((e) => path.join(dir, e));
}

describe("AgentDef schema", () => {
  it("parses all bundled agent templates without error", async () => {
    const files = await listYamls(path.join(TEMPLATES_DIR, "agents"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const raw = parse(await fs.readFile(f, "utf-8"));
      expect(() => AgentDef.parse(raw), `${path.basename(f)} failed`).not.toThrow();
    }
  });
});

describe("TeamDef schema", () => {
  it("parses all bundled team templates without error", async () => {
    const files = await listYamls(path.join(TEMPLATES_DIR, "teams"));
    for (const f of files) {
      const raw = parse(await fs.readFile(f, "utf-8"));
      expect(() => TeamDef.parse(raw), `${path.basename(f)} failed`).not.toThrow();
    }
  });
});

describe("SkillEntry schema", () => {
  it("parses all bundled skill templates without error", async () => {
    const files = await listYamls(path.join(TEMPLATES_DIR, "skills"));
    for (const f of files) {
      const raw = parse(await fs.readFile(f, "utf-8"));
      expect(() => SkillEntry.parse(raw), `${path.basename(f)} failed`).not.toThrow();
    }
  });
});

describe("PackDef schema", () => {
  it("parses all bundled pack definitions without error", async () => {
    const files = await listYamls(PACKS_DIR);
    for (const f of files) {
      const raw = parse(await fs.readFile(f, "utf-8"));
      expect(() => PackDef.parse(raw), `${path.basename(f)} failed`).not.toThrow();
    }
  });
});
```

**Step 2: Run tests to confirm they pass (YAMLs are already valid)**

```bash
npm test tests/schema.test.ts
```

Expected: All PASS.

**Step 3: Commit**

```bash
git add tests/schema.test.ts
git commit -m "test: schema validation for all bundled templates and packs"
```

---

### Task 3: Renderer unit tests

**Files:**
- Create: `tests/renderer.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/renderer.test.ts
import { describe, it, expect } from "vitest";
import { renderSoul, renderTools, renderAgentsFile } from "../src/lib/renderer.js";
import { AgentDef, TeamDef } from "../src/lib/schema.js";

const makeAgent = (overrides: Partial<AgentDef> = {}): AgentDef =>
  AgentDef.parse({
    id: "test-lead",
    name: "Test Lead",
    identity: { emoji: "🧪", vibe: "precise and helpful" },
    soul: {
      persona: "You are {{agent.name}} on the {{team.name}} team.",
      tone: "Direct",
      boundaries: ["Never lie"],
    },
    model: { primary: "claude-sonnet-4-5" },
    capabilities: {
      coordination: { sessions_spawn: true, sessions_send: false },
      file_access: { write: true, edit: true, apply_patch: false },
      system: { exec: false, cron: false, gateway: false },
    },
    team_role: { role: "lead", delegates_to: ["test-specialist"] },
    ...overrides,
  });

const makeTeam = (): TeamDef =>
  TeamDef.parse({
    id: "test-team",
    name: "Test Team",
    members: [
      { agent: "test-lead", role: "lead", entry_point: true },
      { agent: "test-specialist", role: "specialist" },
    ],
    shared_memory: {
      dir: "~/.openclaw-store/workspaces/store/test-team/shared/memory/",
      files: [
        { path: "tasks-log.md", access: "append-only", writer: "*" },
        { path: "brief.md", access: "single-writer", writer: "test-lead" },
      ],
    },
  });

describe("renderSoul", () => {
  it("substitutes {{agent.name}} and {{team.name}}", () => {
    const soul = renderSoul({ agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead", entry_point: true } });
    expect(soul).toContain("You are Test Lead on the Test Team team.");
    expect(soul).not.toContain("{{agent.name}}");
    expect(soul).not.toContain("{{team.name}}");
  });

  it("includes boundaries as bullet list", () => {
    const soul = renderSoul({ agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead" } });
    expect(soul).toContain("- Never lie");
  });
});

describe("renderTools", () => {
  it("shows sessions_spawn as enabled for lead", () => {
    const tools = renderTools({ agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead" } });
    expect(tools).toContain("sessions_spawn (orchestrate sub-agents): ✓ enabled");
  });

  it("shows sessions_send as disabled always", () => {
    const tools = renderTools({ agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead" } });
    expect(tools).toContain("sessions_send (direct peer messaging): ✗ disabled");
  });
});

describe("renderAgentsFile", () => {
  it("marks current agent with YOU arrow", () => {
    const specialist = AgentDef.parse({
      id: "test-specialist",
      name: "Test Specialist",
      soul: { persona: "You are {{agent.name}}." },
      model: { primary: "claude-haiku-4-5" },
      capabilities: {},
      team_role: { role: "specialist" },
    });
    const allMembers = [
      { member: { agent: "test-lead", role: "lead" as const, entry_point: true }, agent: makeAgent() },
      { member: { agent: "test-specialist", role: "specialist" as const }, agent: specialist },
    ];
    const agentsFile = renderAgentsFile(
      { agent: specialist, team: makeTeam(), member: { agent: "test-specialist", role: "specialist" } },
      allMembers,
    );
    expect(agentsFile).toContain("← **YOU**");
  });

  it("shows single-writer access as WRITE for the designated writer", () => {
    const agentsFile = renderAgentsFile(
      { agent: makeAgent(), team: makeTeam(), member: { agent: "test-lead", role: "lead", entry_point: true } },
      [{ member: { agent: "test-lead", role: "lead" as const, entry_point: true }, agent: makeAgent() }],
    );
    expect(agentsFile).toContain("WRITE (you are the sole writer)");
  });

  it("shows single-writer access as read only for non-writers", () => {
    const specialist = AgentDef.parse({
      id: "test-specialist",
      name: "Test Specialist",
      soul: { persona: "spec" },
      model: { primary: "claude-haiku-4-5" },
      capabilities: {},
    });
    const agentsFile = renderAgentsFile(
      { agent: specialist, team: makeTeam(), member: { agent: "test-specialist", role: "specialist" } },
      [{ member: { agent: "test-specialist", role: "specialist" as const }, agent: specialist }],
    );
    expect(agentsFile).toContain("read only");
  });
});
```

**Step 2: Run**

```bash
npm test tests/renderer.test.ts
```

Expected: All PASS.

**Step 3: Commit**

```bash
git add tests/renderer.test.ts
git commit -m "test: renderer unit tests for substitution and access descriptions"
```

---

### Task 4: Local overlay directories (custom templates without forking)

**Files:**
- Modify: `src/lib/paths.ts` (add overlay resolution)
- Modify: `src/lib/loader.ts` (check overlay before bundled)
- Create: `tests/overlay.test.ts`

**Step 1: Write failing test first**

```typescript
// tests/overlay.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-overlay-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("overlay loader", () => {
  it("loads agent from overlay directory when present, ignoring bundled", async () => {
    // Create an overlay agent file with different name
    const agentsDir = path.join(tmpDir, "agents");
    await fs.mkdir(agentsDir);
    await fs.writeFile(
      path.join(agentsDir, "pm.yaml"),
      `id: pm\nversion: 1\nname: "Custom PM"\nsoul:\n  persona: "Custom persona"\nmodel:\n  primary: "claude-haiku-4-5"\ncapabilities: {}\nteam_role:\n  role: lead\n`,
    );
    process.env.OPENCLAW_STORE_TEMPLATES = tmpDir;
    // Dynamically re-import to pick up env var
    const { loadAgent } = await import("../src/lib/loader.js");
    const agent = await loadAgent("pm");
    expect(agent.name).toBe("Custom PM");
    delete process.env.OPENCLAW_STORE_TEMPLATES;
  });
});
```

**Step 2: Run to confirm it fails** (loader doesn't check overlay yet)

```bash
npm test tests/overlay.test.ts
```

Expected: FAIL — agent loads bundled "Project Manager" name, not "Custom PM"

**Step 3: Add overlay resolution to `src/lib/paths.ts`**

Add after the existing template path functions:

```typescript
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
```

**Step 4: Update `src/lib/loader.ts` `loadAgent` to check overlay first**

Replace `loadAgent`:

```typescript
export async function loadAgent(agentId: string): Promise<AgentDef> {
  const overlay = resolveOverlayTemplatesDir();
  if (overlay) {
    const overlayPath = path.join(overlay, "agents", `${agentId}.yaml`);
    if (await fileExists(overlayPath)) {
      const raw = await readYaml<unknown>(overlayPath);
      return AgentDef.parse(raw);
    }
  }
  const filePath = path.join(resolveAgentTemplatesDir(), `${agentId}.yaml`);
  const raw = await readYaml<unknown>(filePath);
  return AgentDef.parse(raw);
}
```

Apply same overlay pattern to `loadTeam`, `loadSkill`, `loadPack`.

**Step 5: Re-run tests**

```bash
npm test tests/overlay.test.ts
```

Expected: PASS

**Step 6: Run full suite to check no regressions**

```bash
npm test
```

Expected: All PASS

**Step 7: Commit**

```bash
git add src/lib/paths.ts src/lib/loader.ts tests/overlay.test.ts
git commit -m "feat: local overlay directory for custom templates (OPENCLAW_STORE_TEMPLATES)"
```

---

### Task 5: Multi-team pack support

**Files:**
- Modify: `src/lib/paths.ts` (allow test-only pack/template root overrides)
- Modify: `src/lib/loader.ts` (use injectable roots for tests)
- Modify: `src/lib/resolver.ts` (fix `teams[0]` limitation)
- Create: `tests/resolver.test.ts`

**Implementation note:** Do not add fixture packs under `tests/fixtures/` until the loader can read from test-specific roots. Otherwise the multi-team test fails because the pack cannot be found, not because `teams[0]` is still broken.

**Step 1: Add injectable loader roots for tests**

Before writing the multi-team fixture test, add test-only path resolution so `loadPack()` and related helpers can read from fixture directories:

```typescript
// in src/lib/paths.ts
export function resolvePacksDir(): string {
  const env = process.env.OPENCLAW_STORE_PACKS_DIR?.trim();
  if (env) return env;
  return path.resolve(__dirname, "..", "..", "packs");
}

export function resolveTemplatesRoot(): string {
  const env = process.env.OPENCLAW_STORE_BUNDLED_TEMPLATES?.trim();
  if (env) return env;
  return path.resolve(__dirname, "..", "..", "templates");
}
```

Use the existing loader helpers so tests can point at fixture directories without changing production behavior.

**Step 2: Write baseline resolver test**

```typescript
// tests/resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveManifest } from "../src/lib/resolver.js";

describe("resolveManifest", () => {
  it("resolves all agents from a single-team pack", async () => {
    const result = await resolveManifest({
      version: 1,
      packs: [{ id: "dev-company" }],
      skills: [],
    });
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0].agents.length).toBeGreaterThanOrEqual(7);
    const agentIds = result.packs[0].agents.map((a) => a.agentId);
    expect(agentIds.some((id) => id.includes("pm"))).toBe(true);
    expect(agentIds.some((id) => id.includes("tech-lead"))).toBe(true);
  });

  it("resolves skills with inactive status when env var is missing", async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await resolveManifest({
      version: 1,
      packs: [],
      skills: [{ id: "last30days" }],
    });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].status).toBe("inactive");
    expect(result.skills[0].missingEnv).toContain("OPENAI_API_KEY");
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  });

  it("builds a valid lockfile with all resolved agents", async () => {
    const result = await resolveManifest({
      version: 1,
      packs: [{ id: "dev-company" }],
      skills: [],
    });
    expect(result.lockfile.version).toBe(1);
    expect(result.lockfile.packs).toHaveLength(1);
    expect(result.lockfile.packs![0].agents.length).toBeGreaterThanOrEqual(7);
  });
});
```

**Step 3: Run to confirm passing (single-team case already works)**

```bash
npm test tests/resolver.test.ts
```

Expected: PASS — confirm baseline before multi-team change.

**Step 4: Write multi-team test**

Add to `tests/resolver.test.ts`:

```typescript
  it("resolves multiple teams from a multi-team pack", async () => {
    // Use a fixture multi-team pack
    // We'll add a test pack in the next step
    const result = await resolveManifest({
      version: 1,
      packs: [{ id: "multi-team-fixture" }],
      skills: [],
    });
    expect(result.packs.length).toBeGreaterThanOrEqual(2);
    const teamIds = result.packs.map((p) => p.teamDef.id);
    expect(teamIds).toContain("dev-company");
    expect(teamIds).toContain("research-lab");
  });
```

**Step 5: Create fixture pack**

```yaml
# tests/fixtures/packs/multi-team-fixture.yaml
id: multi-team-fixture
version: "1.0.0"
name: "Multi Team Fixture"
description: "Test fixture only"
teams:
  - dev-company
  - research-lab
```

**Step 6: Point loader at fixture pack dir and run — confirm it FAILS** (resolver only takes teams[0])

```bash
OPENCLAW_STORE_PACKS_DIR=$PWD/tests/fixtures/packs npm test tests/resolver.test.ts
```

Expected: FAIL on multi-team test.

**Step 7: Fix `src/lib/resolver.ts`**

Replace the pack resolution loop body:

```typescript
  for (const packRef of manifest.packs ?? []) {
    const packDef = await loadPack(packRef.id);

    // Support multi-team packs: resolve each team separately
    for (const teamId of packDef.teams) {
      const teamDef = await loadTeam(teamId);

      const resolvedAgents: ResolvedAgent[] = [];
      for (const member of teamDef.members) {
        const agentDef = await loadAgent(member.agent);
        const agentId = resolveAgentId(teamId, agentDef.id);
        const workspaceDir = resolveAgentWorkspaceDir(teamId, agentDef.id);
        const agentDir = resolveOpenClawAgentDir(teamId, agentDef.id);
        resolvedAgents.push({ agentDef, teamDef, agentId, workspaceDir, agentDir });
      }

      packs.push({
        packId: packRef.id,
        version: packDef.version,
        teamDef,
        agents: resolvedAgents,
      });
    }
  }
```

Also update `buildLockedPack` to use `teamDef.id` as a discriminator since one pack now produces multiple entries:

```typescript
function buildLockedPack(resolved: ResolvedPack): LockedPack {
  return {
    type: "pack",
    id: `${resolved.packId}__${resolved.teamDef.id}`,  // unique per team
    version: resolved.version,
    agents: resolved.agents.map((a) => ({
      id: a.agentId,
      workspace: a.workspaceDir,
      agent_dir: a.agentDir,
    })),
  };
}
```

**Step 8: Run all tests**

```bash
OPENCLAW_STORE_PACKS_DIR=$PWD/tests/fixtures/packs npm test
```

Expected: All PASS

**Step 9: Commit**

```bash
git add src/lib/resolver.ts tests/resolver.test.ts tests/fixtures/
git commit -m "feat: multi-team pack support in resolver"
```

---

### Task 6: Pack compatibility metadata

**Files:**
- Modify: `src/lib/schema.ts` (add `compatibility` field to PackDef)
- Modify: `packs/*.yaml` (add compatibility block)
- Create: `src/lib/compat.ts`
- Modify: `src/commands/doctor.ts`
- Create: `tests/compat.test.ts`

**Step 1: Add compatibility fields to PackDef in `src/lib/schema.ts`**

```typescript
export const PackDef = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string().optional(),
  teams: z.array(z.string()),
  default_skills: z.array(z.string()).optional(),
  compatibility: z
    .object({
      openclaw_min: z.string().optional(),  // e.g. "2026.2.0"
      openclaw_max: z.string().optional(),  // exclusive upper bound
      node_min: z.string().optional(),      // e.g. "22.0.0"
    })
    .optional(),
});
```

**Step 2: Add compatibility block to all 4 pack YAMLs**

```yaml
# append to each packs/*.yaml
compatibility:
  openclaw_min: "2026.2.9"
  node_min: "22.0.0"
```

**Step 3: Create `src/lib/compat.ts`**

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PackDef } from "./schema.js";

const execFileAsync = promisify(execFile);

export type CompatResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
};

/** Read OpenClaw's version via CLI probe. */
export async function readOpenClawVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("openclaw", ["--version"]);
    const match = stdout.match(/(\d{4}\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/);
    return match?.[1] ?? stdout.trim() || null;
  } catch {
    return null;
  }
}

function semverGte(a: string, b: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return (aPatch ?? 0) >= (bPatch ?? 0);
}

export async function checkPackCompatibility(packs: PackDef[]): Promise<CompatResult> {
  const result: CompatResult = { ok: true, warnings: [], errors: [] };
  const ocVersion = await readOpenClawVersion();
  const nodeVersion = process.version.replace(/^v/, "");

  for (const pack of packs) {
    const compat = pack.compatibility;
    if (!compat) continue;

    if (compat.node_min && !semverGte(nodeVersion, compat.node_min)) {
      result.errors.push(
        `Pack ${pack.id} requires Node >= ${compat.node_min}, got ${nodeVersion}`,
      );
      result.ok = false;
    }

    if (compat.openclaw_min) {
      if (!ocVersion) {
        result.warnings.push(
          `Pack ${pack.id} requires OpenClaw >= ${compat.openclaw_min} but version could not be detected via CLI probe`,
        );
      } else if (!semverGte(ocVersion, compat.openclaw_min)) {
        result.errors.push(
          `Pack ${pack.id} requires OpenClaw >= ${compat.openclaw_min}, detected ${ocVersion}`,
        );
        result.ok = false;
      }
    }
  }

  return result;
}
```

**Step 3.5: Add a feature-based follow-up check**

Compatibility should not rely only on version strings. In `doctor`, add at least one capability probe for the installer's required config surface, for example:
- `agents.list` exists and is writable
- `tools.agentToAgent.allow` is supported
- OpenClaw hot reload is enabled or documented as required

If the CLI version is undetectable but the required config surface is present, emit a warning rather than a hard error.

**Step 4: Write tests**

```typescript
// tests/compat.test.ts
import { describe, it, expect } from "vitest";
import { checkPackCompatibility } from "../src/lib/compat.js";
import { PackDef } from "../src/lib/schema.js";

const makePack = (compat: PackDef["compatibility"]): PackDef =>
  PackDef.parse({
    id: "test",
    version: "1.0.0",
    name: "Test",
    teams: ["dev-company"],
    compatibility: compat,
  });

describe("checkPackCompatibility", () => {
  it("passes when no compatibility requirements", async () => {
    const result = await checkPackCompatibility([makePack(undefined)]);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when node version is too old", async () => {
    const result = await checkPackCompatibility([makePack({ node_min: "999.0.0" })]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/Node >= 999/);
  });

  it("passes with satisfied node version", async () => {
    const result = await checkPackCompatibility([makePack({ node_min: "1.0.0" })]);
    expect(result.ok).toBe(true);
  });
});
```

**Step 5: Run**

```bash
npm test tests/compat.test.ts
```

Expected: All PASS

**Step 6: Wire into `src/commands/doctor.ts`**

Add after existing checks:

```typescript
  // Check 7: pack compatibility
  const { checkPackCompatibility } = await import("../lib/compat.js");
  const { loadAllPacks } = await import("../lib/loader.js");
  if (lockfile) {
    const installedPackIds = [...new Set((lockfile.packs ?? []).map((p) => p.id.split("__")[0]))];
    const packDefs = await Promise.all(installedPackIds.map((id) =>
      loadPack(id).catch(() => null)
    ));
    const validPacks = packDefs.filter((p): p is PackDef => p !== null);
    const compatResult = await checkPackCompatibility(validPacks);
    for (const e of compatResult.errors) {
      findings.push({ severity: "error", message: e });
    }
    for (const w of compatResult.warnings) {
      findings.push({ severity: "warning", message: w });
    }
    if (compatResult.ok && validPacks.length > 0) {
      findings.push({ severity: "ok", message: "Pack compatibility OK" });
    }
  }
```

**Step 7: Commit**

```bash
git add src/lib/schema.ts src/lib/compat.ts src/commands/doctor.ts packs/*.yaml tests/compat.test.ts
git commit -m "feat: pack compatibility metadata and version checks in doctor"
```

---

### Task 7: Real skill installation

**Files:**
- Create: `src/lib/skill-fetch.ts`
- Modify: `src/commands/install.ts` (wire real skill install after workspace creation)
- Create: `tests/skill-fetch.test.ts`

**Architecture note:** Do not copy every skill into every workspace as the long-term model. The production architecture must use:
- `~/.openclaw-store/cache/skills/<skill>@<version>/` as the canonical fetched cache
- per-agent workspace links or lightweight materialization into `workspace/skills/`
- upgrade logic that refreshes the cached copy once and then relinks dependents

For Phase 1, prefer symlinks. If a platform-specific fallback is needed, copy only when linking is unavailable and record that as a degraded mode.

**Step 1: Create `src/lib/skill-fetch.ts`**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { SkillEntry } from "./schema.js";

export type SkillInstallResult = {
  skillId: string;
  status: "installed" | "skipped" | "failed";
  reason?: string;
  targetDir: string;
};

/**
 * Install a skill into the shared cache first, then link it into one or more workspaces.
 * For local skills: canonicalize into ~/.openclaw-store/cache/skills/<id>@<version>/.
 * For openclaw-bundled: resolve from ~/.openclaw/skills/<id> or ~/.openclaw/workspace/skills/<id>.
 * For clawhub/community sources: Phase 1 may resolve from pre-fetched cache only; real remote fetch remains a later task.
 */
export async function installSkillToWorkspaces(
  skill: SkillEntry,
  workspaceDirs: string[],
  status: "active" | "inactive",
): Promise<SkillInstallResult[]> {
  if (status === "inactive") {
    return workspaceDirs.map((dir) => ({
      skillId: skill.id,
      status: "skipped" as const,
      reason: "inactive — missing required env vars",
      targetDir: path.join(dir, "skills", skill.id),
    }));
  }

  const source = await resolveSkillSource(skill);
  if (!source) {
    return workspaceDirs.map((dir) => ({
      skillId: skill.id,
      status: "failed" as const,
      reason: `Skill source not found. ${skill.install_hints?.[0] ?? ""}`.trim(),
      targetDir: path.join(dir, "skills", skill.id),
    }));
  }

  const cacheDir = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? "",
    ".openclaw-store",
    "cache",
    "skills",
    `${skill.id}@${skill.version}`,
  );
  await fs.rm(cacheDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(cacheDir), { recursive: true });
  await fs.cp(source, cacheDir, { recursive: true });

  const results: SkillInstallResult[] = [];
  for (const workspaceDir of workspaceDirs) {
    const targetDir = path.join(workspaceDir, "skills", skill.id);
    try {
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.symlink(cacheDir, targetDir, "dir");
      results.push({ skillId: skill.id, status: "installed", targetDir });
    } catch (err) {
      try {
        await fs.cp(cacheDir, targetDir, { recursive: true });
        results.push({
          skillId: skill.id,
          status: "installed",
          reason: "copied fallback (symlink unavailable)",
          targetDir,
        });
      } catch (copyErr) {
        results.push({
          skillId: skill.id,
          status: "failed",
          reason: copyErr instanceof Error ? copyErr.message : String(copyErr),
          targetDir,
        });
      }
    }
  }
  return results;
}

async function resolveSkillSource(skill: SkillEntry): Promise<string | null> {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  if (skill.source.type === "local" && skill.source.url) {
    const src = skill.source.url.startsWith("~")
      ? path.join(home, skill.source.url.slice(1))
      : skill.source.url;
    if (await pathExists(src)) return src;
    return null;
  }

  // openclaw-bundled or clawhub: look in user skill cache dirs
  const candidates = [
    path.join(home, ".openclaw", "workspace", "skills", skill.id),
    path.join(home, ".openclaw", "skills", skill.id),
    path.join(home, ".openclaw-store", "cache", "skills", skill.id),
  ];
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
```

**Step 2: Write tests**

```typescript
// tests/skill-fetch.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installSkillToWorkspaces } from "../src/lib/skill-fetch.js";
import { SkillEntry } from "../src/lib/schema.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-skill-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const makeLocalSkill = (skillDir: string): SkillEntry =>
  SkillEntry.parse({
    id: "test-skill",
    version: 1,
    name: "Test Skill",
    source: { type: "local", url: skillDir },
    trust_tier: "local",
    disabled_until_configured: false,
  });

describe("installSkillToWorkspaces", () => {
  it("installs local skill into cache and exposes it in workspace skills directory", async () => {
    // Set up a fake skill source
    const skillSrc = path.join(tmpDir, "skill-src");
    await fs.mkdir(skillSrc);
    await fs.writeFile(path.join(skillSrc, "SKILL.md"), "# Test Skill\n");

    const workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir);

    const results = await installSkillToWorkspaces(makeLocalSkill(skillSrc), [workspaceDir], "active");
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("installed");

    const installedFile = path.join(workspaceDir, "skills", "test-skill", "SKILL.md");
    const content = await fs.readFile(installedFile, "utf-8");
    expect(content).toContain("Test Skill");
  });

  it("skips installation when skill is inactive", async () => {
    const workspaceDir = path.join(tmpDir, "workspace");
    const results = await installSkillToWorkspaces(makeLocalSkill("/nonexistent"), [workspaceDir], "inactive");
    expect(results[0].status).toBe("skipped");
  });

  it("returns failed when skill source not found", async () => {
    const workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir);
    const results = await installSkillToWorkspaces(makeLocalSkill("/does/not/exist"), [workspaceDir], "active");
    expect(results[0].status).toBe("failed");
  });
});
```

**Step 3: Run**

```bash
npm test tests/skill-fetch.test.ts
```

Expected: All PASS

**Step 4: Wire into `src/commands/install.ts`**

After the `installTeam()` call and before `seedTeamSharedMemory()`, add:

```typescript
    // Install skills into each agent workspace that lists them
    if (skills.length > 0) {
      const { installSkillToWorkspaces } = await import("../lib/skill-fetch.js");
      for (const resolvedSkill of skills) {
        // Find all agent workspaces that need this skill
        const targetWorkspaces: string[] = [];
        for (const pack of packs) {
          for (const agent of pack.agents) {
            if (agent.agentDef.skills?.includes(resolvedSkill.skillDef.id)) {
              targetWorkspaces.push(agent.workspaceDir);
            }
          }
        }
        if (targetWorkspaces.length === 0) continue;
        const results = await installSkillToWorkspaces(
          resolvedSkill.skillDef,
          targetWorkspaces,
          resolvedSkill.status,
        );
        for (const r of results) {
          if (r.status === "installed") {
            console.log(`  ✓ Skill ${resolvedSkill.skillDef.id} → ${r.targetDir}`);
          } else if (r.status === "failed") {
            console.warn(`  ✗ Skill ${resolvedSkill.skillDef.id} failed: ${r.reason}`);
          }
        }
      }
    }
```

**Step 5: Build + smoke-test**

```bash
npm run build
node dist/cli.js install --pack dev-company --dry-run
```

Expected: Dry-run output unchanged (skill install is a post-workspace step, not in plan).

**Step 5.5: Add a scale-safety doc note**

Document explicitly that:
- catalog size can be large
- active installed teams should remain small
- skills are cached once and linked many times
- future upgrade logic must update the cache and then relink, not duplicate

**Step 6: Commit**

```bash
git add src/lib/skill-fetch.ts src/commands/install.ts tests/skill-fetch.test.ts
git commit -m "feat: real skill installation into agent workspace skills/ directories"
```

---

### Task 8: `openclaw-store diff` command

Shows what would change if you re-ran `openclaw-store install` against the current lockfile.

**Files:**
- Create: `src/commands/diff.ts`
- Modify: `src/cli.ts` (register `diff` command)
- Create: `tests/diff.test.ts`

**Step 1: Create `src/commands/diff.ts`**

```typescript
import { loadManifest, loadLockfile } from "../lib/loader.js";
import { resolveManifest } from "../lib/resolver.js";

type DiffEntry = {
  type: "added" | "removed" | "changed" | "unchanged";
  kind: "agent" | "skill";
  id: string;
  detail?: string;
};

export async function runDiff(projectDir?: string): Promise<void> {
  const manifest = await loadManifest(projectDir);
  const existing = await loadLockfile(projectDir);

  if (!existing) {
    console.log("No lockfile. Run: openclaw-store install");
    return;
  }

  const { packs: newPacks, skills: newSkills } = await resolveManifest(manifest);

  const diffs: DiffEntry[] = [];

  // Compare agents
  const existingAgentIds = new Set(
    (existing.packs ?? []).flatMap((p) => p.agents.map((a) => a.id)),
  );
  const newAgentIds = new Set(newPacks.flatMap((p) => p.agents.map((a) => a.agentId)));

  for (const id of newAgentIds) {
    if (!existingAgentIds.has(id)) {
      diffs.push({ type: "added", kind: "agent", id });
    } else {
      diffs.push({ type: "unchanged", kind: "agent", id });
    }
  }
  for (const id of existingAgentIds) {
    if (!newAgentIds.has(id)) {
      diffs.push({ type: "removed", kind: "agent", id });
    }
  }

  // Compare skills
  const existingSkillMap = new Map(
    (existing.skills ?? []).map((s) => [s.id, s.status]),
  );
  for (const s of newSkills) {
    const prevStatus = existingSkillMap.get(s.skillDef.id);
    if (prevStatus === undefined) {
      diffs.push({ type: "added", kind: "skill", id: s.skillDef.id });
    } else if (prevStatus !== s.status) {
      diffs.push({
        type: "changed",
        kind: "skill",
        id: s.skillDef.id,
        detail: `${prevStatus} → ${s.status}`,
      });
    }
  }

  const added = diffs.filter((d) => d.type === "added");
  const removed = diffs.filter((d) => d.type === "removed");
  const changed = diffs.filter((d) => d.type === "changed");

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log("✓ No changes. Lockfile is up to date.");
    return;
  }

  if (added.length > 0) {
    console.log("\n+ Added:");
    for (const d of added) console.log(`  + [${d.kind}] ${d.id}`);
  }
  if (removed.length > 0) {
    console.log("\n- Removed:");
    for (const d of removed) console.log(`  - [${d.kind}] ${d.id}`);
  }
  if (changed.length > 0) {
    console.log("\n~ Changed:");
    for (const d of changed) console.log(`  ~ [${d.kind}] ${d.id}  ${d.detail ?? ""}`);
  }
  console.log(`\nRun: openclaw-store install to apply these changes.`);
}
```

**Step 2: Register in `src/cli.ts`**

```typescript
program
  .command("diff")
  .description("Show what would change if you ran install against current lockfile")
  .action(async () => {
    const { runDiff } = await import("./commands/diff.js");
    await runDiff();
  });
```

**Step 3: Write test**

```typescript
// tests/diff.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { runDiff } from "../src/commands/diff.js";

// Test via console output capture
describe("runDiff", () => {
  it("runs without error when lockfile exists", async () => {
    // If no lockfile this should print "No lockfile" without throwing
    const origCwd = process.cwd();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocs-diff-"));
    process.chdir(tmpDir);
    try {
      await fs.writeFile(
        path.join(tmpDir, "openclaw-store.yaml"),
        stringify({ version: 1, packs: [{ id: "dev-company" }], skills: [] }),
      );
      // Should not throw even without lockfile
      await expect(runDiff(tmpDir)).resolves.not.toThrow();
    } finally {
      process.chdir(origCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
```

**Step 4: Run**

```bash
npm test tests/diff.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/diff.ts src/cli.ts tests/diff.test.ts
git commit -m "feat: openclaw-store diff command to preview lockfile changes"
```

---

### Task 9: `openclaw-store validate` command

Validates all templates in the active templates path against schema and reports errors.

**Files:**
- Create: `src/commands/validate.ts`
- Modify: `src/cli.ts`

**Step 1: Create `src/commands/validate.ts`**

```typescript
import { loadAllAgents, loadAllTeams, loadAllSkills, loadAllPacks } from "../lib/loader.js";
import { ZodError } from "zod";

type ValidationResult = {
  file: string;
  ok: boolean;
  errors: string[];
};

export async function runValidate(): Promise<void> {
  const results: ValidationResult[] = [];

  const runners: Array<{ label: string; fn: () => Promise<unknown[]> }> = [
    { label: "agents", fn: loadAllAgents },
    { label: "teams", fn: loadAllTeams },
    { label: "skills", fn: loadAllSkills },
    { label: "packs", fn: loadAllPacks },
  ];

  for (const runner of runners) {
    try {
      await runner.fn();
      results.push({ file: runner.label, ok: true, errors: [] });
    } catch (err) {
      const msgs = err instanceof ZodError
        ? err.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`)
        : [err instanceof Error ? err.message : String(err)];
      results.push({ file: runner.label, ok: false, errors: msgs });
    }
  }

  let allOk = true;
  for (const r of results) {
    if (r.ok) {
      console.log(`✓ ${r.file}`);
    } else {
      allOk = false;
      console.log(`✗ ${r.file}`);
      for (const e of r.errors) console.log(`    ${e}`);
    }
  }

  if (!allOk) {
    console.log("\nValidation failed. Fix the errors above.");
    process.exit(1);
  } else {
    console.log("\n✓ All templates valid.");
  }
}
```

**Step 2: Register and test inline (no separate test file needed — schema tests already cover this)**

```bash
npm run build && node dist/cli.js validate
```

Expected: `✓ All templates valid.`

**Step 3: Commit**

```bash
git add src/commands/validate.ts src/cli.ts
git commit -m "feat: openclaw-store validate command for schema validation of all templates"
```

---

### Task 10: Contributing infrastructure

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `.github/workflows/ci.yml`
- Create: `templates/agents/_template.yaml` (submission template)
- Create: `templates/teams/_template.yaml`

**Step 1: Create `CONTRIBUTING.md`**

```markdown
# Contributing to openclaw-app-store

## Submitting a new agent, team, or pack

1. Fork this repo
2. Copy `templates/agents/_template.yaml` to `templates/agents/<your-id>.yaml`
3. Fill in all required fields (schema reference: `docs/how-it-works.md`)
4. Run `openclaw-store validate` — must pass with zero errors
5. Add a team or pack YAML that uses your agent (optional but recommended)
6. Add yourself to the `contributors/` directory (see `contributors/_template.md`)
7. Open a PR with title: `feat(template): add <your-agent-name>`

## Checklist before submitting

- [ ] `openclaw-store validate` passes
- [ ] `npm test` passes
- [ ] Agent has a realistic `soul.persona` with correct `{{variable}}` syntax
- [ ] Capabilities match the role (`sessions_spawn: false` for non-leads)
- [ ] All `shared_memory` files have explicit `access` and `writer` fields
- [ ] A `description` is provided in the pack YAML
- [ ] Trust tier is set correctly (`local` for personal, `community` for submissions)

## Trust tiers

| Tier | Requirements |
|---|---|
| `local` | User-owned, not reviewed |
| `community` | PR reviewed, schema valid, example included |
| `curated` | Maintainer-recommended, tested on multiple OpenClaw versions |
| `official` | Maintained by this repo |

## Running tests

```bash
npm install
npm test
npm run build
openclaw-store validate
```

## Compatibility policy

Each pack YAML should include a `compatibility` block declaring the minimum OpenClaw and Node versions it was tested with. CI will validate against the versions listed in `compatibility-matrix.yaml`.
```

**Step 2: Create `_template.yaml` files**

```yaml
# templates/agents/_template.yaml
# Copy this file to templates/agents/<your-id>.yaml and fill in.
id: your-agent-id          # kebab-case, unique
version: 1
name: "Your Agent Name"

identity:
  emoji: "🤖"
  vibe: "One-line description of personality"

soul:
  persona: |
    You are {{agent.name}} on the {{team.name}} team.
    [Describe role, responsibilities, and workflow here.]
  tone: "How this agent communicates"
  boundaries:
    - "What this agent never does"

model:
  primary: "claude-sonnet-4-5"   # opus | sonnet | haiku
  fallback: "claude-haiku-4-5"

capabilities:
  coordination:
    sessions_spawn: false   # true for leads only
    sessions_send: false    # always false
  file_access:
    write: false
    edit: false
    apply_patch: false
  system:
    exec: false
    cron: false
    gateway: false

skills: []

team_role:
  role: specialist   # lead | specialist | reviewer
```

```yaml
# templates/teams/_template.yaml
id: your-team-id
name: "Your Team Name"
version: 1

members:
  - agent: your-lead-agent
    role: lead
    entry_point: true
  - agent: your-specialist
    role: specialist

graph:
  - from: your-lead-agent
    to: your-specialist
    relationship: delegates_to

shared_memory:
  dir: "~/.openclaw-store/workspaces/store/your-team-id/shared/memory/"
  files:
    - path: tasks-log.md
      access: append-only
      writer: "*"
    - path: brief.md
      access: single-writer
      writer: your-lead-agent
```

**Step 3: Create GitHub Actions CI workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ["22.x"]

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Type-check
        run: npx tsc --noEmit

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

      - name: Validate templates
        run: node dist/cli.js validate
```

**Step 4: Commit**

```bash
git add CONTRIBUTING.md .github/ templates/agents/_template.yaml templates/teams/_template.yaml
git commit -m "chore: contributing guide, CI workflow, and submission templates"
```

---

### Task 11: Error handling polish + `--no-openclaw` flag

Make the install command work in environments without OpenClaw (useful for CI, dry-testing, and Claude Code path).

**Files:**
- Modify: `src/commands/install.ts`
- Modify: `src/lib/adapters/openclaw.ts`

**Step 1: Add `--no-openclaw` flag to install command in `src/cli.ts`**

```typescript
program
  .command("install")
  .option("--no-openclaw", "Skip openclaw.json patching (use with Claude Code or CI)")
  // ... existing options
  .action(async (opts) => {
    await runInstall({
      ...
      noOpenclaw: opts.noOpenclaw,
    });
  });
```

**Step 2: Thread `noOpenclaw` through `InstallOptions` and the install command**

In `src/commands/install.ts`, wrap the config-patching call:

```typescript
    if (!opts.noOpenclaw) {
      await installTeam({ ... });
    } else {
      // Just write workspace files, skip openclaw.json
      await installTeamWorkspacesOnly({ ... });
    }
```

Add `installTeamWorkspacesOnly` to `src/lib/adapters/openclaw.ts` — same as `installTeam` but skips the config patch step.

**Step 3: Graceful error when `openclaw.json` is missing**

In `readOpenClawConfig`, catch ENOENT specifically and throw with a helpful message:

```typescript
  } catch (err) {
    const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT";
    if (isNotFound) {
      throw new Error(
        `OpenClaw config not found at ${configPath}.\n` +
        `Either install OpenClaw first, or run: openclaw-store install --no-openclaw`,
      );
    }
    throw new Error(`Failed to read OpenClaw config at ${configPath}: ${msg}`);
  }
```

**Step 4: Build + smoke-test**

```bash
npm run build
cd /tmp/test-ocs && openclaw-store init
openclaw-store install --no-openclaw
```

Expected:
- install succeeds without requiring `~/.openclaw/openclaw.json`
- `openclaw-store.lock` is written
- workspace files are created under `~/.openclaw-store/`
- no OpenClaw config patch is attempted

**Step 5: Commit**

```bash
git add src/
git commit -m "feat: --no-openclaw flag for CI and Claude Code environments"
```

---

### Task 12: Phase 1 tag

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

**Step 2: Build**

```bash
npm run build
node dist/cli.js validate
```

Expected: `✓ All templates valid.`

**Step 3: Update version in package.json to 1.0.0**

```json
"version": "1.0.0"
```

**Step 4: Final commit and tag**

```bash
git add package.json
git commit -m "chore: bump to v1.0.0 — Phase 1 open source baseline"
git tag v1.0.0
```

---

## Phase 2 — Dashboard + Community (Tasks 13–22)

> Full task-level plans to be written in `docs/plans/2026-XX-XX-phase-2-dashboard.md` when Phase 1 ships.

### Task 13: Web dashboard backend (read-only)

**Files:** `src/server/index.ts`, `src/server/routes.ts`, `src/server/middleware.ts`

Express/Fastify HTTP server. Reads manifest, lockfile, runtime state, and openclaw.json.
Serves JSON API at `/api/v1/`: `GET /packs`, `GET /agents`, `GET /teams`, `GET /skills`, `GET /health`.
CLI command: `openclaw-store dashboard [--port 3456]`.

### Task 14: Web dashboard frontend — Catalog Browser

**Files:** `src/server/public/index.html`, `src/server/public/app.js`

Vanilla JS (no framework for v1 to minimise bundle complexity).
Views: Pack catalog cards, Agent detail panel, Team graph (SVG), Shared memory file ownership table.
Reads from dashboard API.

### Task 15: Dashboard — Operations views

Kanban board reader (renders team's `kanban.md`), tasks-log reader (last N lines), blockers viewer.
Live-update via polling or `EventSource`.
Read-only in v1. Write support (updating kanban, approving tasks) in Phase 3.

### Task 16: Dashboard — Health and cost view

Aggregate `doctor` output as JSON → render as dashboard panel.
Model usage: parse session files from `~/.openclaw/agents/*/sessions/` to estimate token spend.
Skill activation status cards.

### Task 17: Remote pack sources (clawhub fetch)

**Files:** `src/lib/pack-fetch.ts`

Fetch pack YAML from a URL (clawhub or raw GitHub).
Cache to `~/.openclaw-store/cache/packs/<id>-<version>/`.
Verify checksum if provided.
Require `trust_tier: community` or higher for remote installs.
Add `--source <url>` flag to `install` command.

### Task 18: AI-assisted team generation

**Files:** `src/commands/generate.ts`

`openclaw-store generate "I need a team that can..."` — calls Claude API (via `ANTHROPIC_API_KEY`) to generate a pack YAML draft, validates schema, prompts for review, then saves to `templates/` for use in manifest.
`openclaw-store review-pack <id>` — AI reviews pack for race conditions, capability mismatches, and missing memory rules.

### Task 19: Pack contributor automation

**Files:** `scripts/submit-pack.ts`, `.github/PULL_REQUEST_TEMPLATE.md`

`openclaw-store submit` — validates, creates a PR to this repo with the new template.
GitHub Actions job: runs schema validation + dry-run install against PR templates.
Auto-labels submissions by trust tier.

### Task 20: Structured task backend (for high-scale teams)

**Files:** `src/lib/task-store.ts`, using SQLite (same pattern as antfarm)

Optional alternative to Markdown task logs: structured `tasks` table with `agent_id`, `status`, `created_at`, `content`.
Expose via dashboard API.
Enabled by `structured_tasks: true` in manifest.

### Task 21: Upgrade engine

**Files:** `src/commands/upgrade.ts`

`openclaw-store upgrade` — re-resolves manifest against latest template versions, shows diff, applies.
`openclaw-store upgrade --pack dev-company --to 1.1.0`.
Rollback: saves previous lockfile as `openclaw-store.lock.bak` before overwriting.

### Task 22: Phase 2 tag

All Phase 2 tests pass, dashboard serves locally, remote pack fetch works.
`git tag v2.0.0`

---

## Phase 3 — Ecosystem Scale (Tasks 23–28, goal-level)

> Detailed plans to be written in `docs/plans/2026-XX-XX-phase-3-ecosystem.md`.

### Task 23: Community catalog CI and trust promotion

Automated CI pipeline for community submissions. Pack trust promotion workflow (community → curated) via maintainer label.

### Task 24: Pack signing and checksum verification

SHA-256 checksums for remote packs. Optional GPG signing for official/curated tier. Verify on install.

### Task 25: Claude Code export

Complete `src/lib/adapters/claude-code.ts`. Export installed teams as `.claude/agents/` layout + `CLAUDE.md` entries. `openclaw-store export --format claude-code`.

### Task 26: Structured task/event backend for large orgs

Multi-team event bus via SQLite WAL. Agent activity timeline. Cross-team task hand-off protocol.

### Task 27: OpenClaw compatibility matrix

`compatibility-matrix.yaml` — tested OpenClaw version ranges per pack. CI tests against OpenClaw stable + latest beta. `doctor` checks against matrix and warns on untested combinations.

### Task 28: Optional Electron wrapper

Wrap the web dashboard in an Electron shell for desktop-first users. Expose via HTTP API internally. Not the primary product — only after web dashboard is stable.

---

## Test Coverage Targets

| Phase | Minimum coverage |
|---|---|
| Phase 1 (v1.0) | schema, renderer, resolver, compat, skill-fetch — >80% line coverage |
| Phase 2 (v2.0) | + dashboard API routes, pack-fetch, task-store |
| Phase 3 (v3.0) | + upgrade engine, signing, catalog CI |

```bash
# Run with coverage
npm run test:coverage
```

---

## How to Verify Phase 1 Complete

```bash
# 1. All tests pass
npm test

# 2. Build clean
npm run build

# 3. Schema validates
node dist/cli.js validate
# → ✓ All templates valid.

# 4. Multi-team pack resolves (requires fixture)
node -e "
import('./dist/lib/resolver.js').then(async ({resolveManifest}) => {
  const r = await resolveManifest({ version: 1, packs: [{id:'dev-company'},{id:'content-factory'}], skills: [] });
  console.log('Teams resolved:', r.packs.map(p => p.teamDef.id));
})"

# 5. Overlay works
OPENCLAW_STORE_TEMPLATES=/tmp/my-templates node dist/cli.js list --agents

# 6. Diff works (with a lockfile present)
node dist/cli.js diff

# 7. No-openclaw flag works in CI
node dist/cli.js install --no-openclaw --dry-run

# 8. Doctor runs clean on a valid install
node dist/cli.js doctor

# 9. CI passes on push
git push && gh run watch
```
