# openclaw-store Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web dashboard (React SPA + Fastify server) that provides visual management of openclaw-store projects, agent teams, skills, and configuration.

**Architecture:** Top-level `dashboard/` directory with its own package.json. Fastify server directly imports `src/lib/` modules via TypeScript project references. REST API for data, WebSocket for file-change notifications. React frontend with TanStack Query for data fetching. No database — existing YAML/JSON files are the data layer.

**Tech Stack:** TypeScript, Fastify, React 19, TanStack Query v5, Vite, chokidar, @fastify/websocket

**Spec:** `docs/superpowers/specs/2026-03-16-dashboard-design.md`

---

## Chunk 1: Prerequisites — Extract CLI Logic into Library Modules

Before the dashboard can import store logic, we need to extract side-effect-free functions from CLI command files. Each extraction follows the same pattern: move the pure logic into `src/lib/`, make the CLI command a thin wrapper.

### Task 1: Extract doctor checks into `src/lib/doctor.ts`

**Files:**
- Create: `src/lib/doctor.ts`
- Create: `tests/doctor.test.ts`
- Modify: `src/commands/doctor.ts`

- [ ] **Step 1: Write the test for `runChecks()`**

```typescript
// tests/doctor.test.ts
import { describe, it, expect, vi } from "vitest";

describe("doctor.runChecks", () => {
  it("returns findings array with severity levels", async () => {
    // Will test after implementation
  });
});
```

Run: `npm test -- tests/doctor.test.ts`
Expected: PASS (empty test)

- [ ] **Step 2: Read `src/commands/doctor.ts` and identify the pure logic**

The function `runDoctor()` at line 45 does these checks:
1. Detect workflow mode
2. Check manifest exists
3. Check openclaw.json accessible
4. Check lockfile exists and has content
5. For each locked pack: check agent workspace exists, check agent registered in openclaw.json
6. Check skill status (active/inactive/failed with env var details)
7. Check pack compatibility

Extract all of this into a `runChecks()` function that returns `Finding[]`.

- [ ] **Step 3: Create `src/lib/doctor.ts` with `Finding` type and `runChecks()`**

Read the existing `src/commands/doctor.ts` to understand the exact check logic. Create `src/lib/doctor.ts` that:
- Exports `type Finding = { check: string; severity: "ok" | "warning" | "error"; message: string; fix?: string }`
- Exports `async function runChecks(opts?: { projectDir?: string }): Promise<Finding[]>`
- Contains all the check logic from `runDoctor()` but returns findings instead of logging
- Does NOT call `console.log`, `console.error`, or `process.exit`

- [ ] **Step 4: Write real tests for `runChecks()`**

Add tests that use fixture data (via env var overrides) to verify:
- Returns findings array
- Severity levels are correct
- Handles missing manifest gracefully
- Handles missing lockfile gracefully

Run: `npm test -- tests/doctor.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor `src/commands/doctor.ts` to use `src/lib/doctor.ts`**

Make `runDoctor()` a thin wrapper:
```typescript
import { runChecks } from "../lib/doctor.js";

export async function runDoctor(autoFix?: boolean): Promise<void> {
  const findings = await runChecks();
  // Format and print findings (existing console.log logic stays here)
  // process.exit(1) if any errors (stays here)
}
```

- [ ] **Step 6: Run all existing tests to verify no regressions**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/doctor.ts tests/doctor.test.ts src/commands/doctor.ts
git commit -m "refactor: extract doctor check logic into src/lib/doctor.ts"
```

---

### Task 2: Extract diff computation into `src/lib/diff.ts`

**Files:**
- Create: `src/lib/diff.ts`
- Create: `tests/diff-lib.test.ts`
- Modify: `src/commands/diff.ts`

- [ ] **Step 1: Create `src/lib/diff.ts` with `DiffEntry` type and `computeDiff()`**

Read `src/commands/diff.ts` (lines 1-90). The `DiffEntry` type is already defined internally at lines 4-9. Move it and the comparison logic to the lib:

```typescript
// src/lib/diff.ts
export type DiffEntry = {
  type: "add" | "remove" | "change";
  kind: "pack" | "skill";
  id: string;
  detail?: string;
};

export async function computeDiff(opts?: { projectDir?: string }): Promise<DiffEntry[]> {
  // Load manifest and lockfile
  // Compare packs and skills
  // Return DiffEntry[] instead of printing
}
```

- [ ] **Step 2: Write tests for `computeDiff()`**

Use fixture manifests/lockfiles to test:
- Empty diff when manifest matches lockfile
- Detects added packs
- Detects removed packs
- Detects skill changes

Run: `npm test -- tests/diff-lib.test.ts`
Expected: PASS

- [ ] **Step 3: Refactor `src/commands/diff.ts` to be a thin wrapper**

```typescript
import { computeDiff } from "../lib/diff.js";

export async function runDiff(projectDir?: string): Promise<void> {
  const entries = await computeDiff({ projectDir });
  if (entries.length === 0) { console.log("No changes."); return; }
  for (const e of entries) { console.log(`${e.type === "add" ? "+" : "-"} ${e.kind}: ${e.id}`); }
}
```

- [ ] **Step 4: Update existing `tests/diff.test.ts`**

The existing `tests/diff.test.ts` tests `runDiff()` from the command. After refactoring, verify these tests still pass since `runDiff()` now wraps `computeDiff()`. If the existing tests import internal types from `src/commands/diff.ts`, update them to import `DiffEntry` from `src/lib/diff.ts` instead.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/diff.ts tests/diff-lib.test.ts tests/diff.test.ts src/commands/diff.ts
git commit -m "refactor: extract diff computation into src/lib/diff.ts"
```

---

### Task 3: Extract install logic into `src/lib/install-headless.ts`

**Files:**
- Create: `src/lib/install-headless.ts`
- Create: `tests/install-headless.test.ts`
- Modify: `src/commands/install.ts`

This is the most complex extraction. The existing `runInstall()` (387 lines) has logging interleaved with logic throughout.

- [ ] **Step 1: Read `src/commands/install.ts` thoroughly**

Identify all pure logic vs CLI-coupled code. Key pure functions already exist:
- `finalizeLockfileSkills()` (line 240) — already pure
- `shouldInstallSkillForAgent()` (line 286) — already pure
- `buildRuntimeProject()` (line 304) — already pure

The main `runInstall()` logic needs a headless version.

- [ ] **Step 2: Create `src/lib/install-headless.ts`**

```typescript
// src/lib/install-headless.ts
export type InstallProgress = {
  phase: "resolving" | "installing" | "skills" | "finalizing";
  message: string;
  current?: number;
  total?: number;
};

export type InstallResult = {
  success: boolean;
  projectId: string;
  packsInstalled: string[];
  skillStatuses: { id: string; status: string; missingEnv?: string[] }[];
  errors: string[];
};

export type InstallOpts = {
  dryRun?: boolean;
  force?: boolean;
  pack?: string;
  projectDir?: string;
  onProgress?: (progress: InstallProgress) => void;
};

export async function runHeadlessInstall(opts: InstallOpts): Promise<InstallResult> {
  // Same logic as runInstall() but:
  // - Calls opts.onProgress() instead of console.log
  // - Returns InstallResult instead of void
  // - Throws on fatal errors instead of process.exit
}
```

- [ ] **Step 3: Extract the core install logic from `src/commands/install.ts`**

Move the install pipeline into `runHeadlessInstall()`. Keep the existing pure helper functions (`finalizeLockfileSkills`, `shouldInstallSkillForAgent`, `buildRuntimeProject`) — move them to the lib file or keep them shared.

- [ ] **Step 4: Refactor `src/commands/install.ts` to wrap `runHeadlessInstall()`**

```typescript
import { runHeadlessInstall } from "../lib/install-headless.js";

export async function runInstall(opts: InstallOptions): Promise<void> {
  const result = await runHeadlessInstall({
    ...opts,
    onProgress: (p) => console.log(`[${p.phase}] ${p.message}`),
  });
  // Print results, exit on failure
}
```

- [ ] **Step 5: Write tests for `runHeadlessInstall()`**

```typescript
// tests/install-headless.test.ts
import { describe, it, expect, vi } from "vitest";
import { runHeadlessInstall, type InstallProgress } from "../src/lib/install-headless.js";

describe("runHeadlessInstall", () => {
  it("returns InstallResult with project info", async () => {
    // Use fixture env vars to point at test data
    const progress: InstallProgress[] = [];
    const result = await runHeadlessInstall({
      onProgress: (p) => progress.push(p),
    });
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("projectId");
    expect(result).toHaveProperty("packsInstalled");
    expect(progress.length).toBeGreaterThan(0);
  });

  it("calls onProgress with phase updates", async () => {
    const progress: InstallProgress[] = [];
    await runHeadlessInstall({
      dryRun: true,
      onProgress: (p) => progress.push(p),
    });
    const phases = progress.map((p) => p.phase);
    expect(phases).toContain("resolving");
  });
});
```

Run: `npm test -- tests/install-headless.test.ts`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS (existing install tests should still work via the wrapper)

- [ ] **Step 7: Commit**

```bash
git add src/lib/install-headless.ts tests/install-headless.test.ts src/commands/install.ts
git commit -m "refactor: extract headless install into src/lib/install-headless.ts"
```

---

### Task 4: Extract skill ops into `src/lib/skill-ops.ts`

**Files:**
- Create: `src/lib/skill-ops.ts`
- Create: `tests/skill-ops.test.ts`
- Modify: `src/commands/skill.ts`

- [ ] **Step 1: Read `src/commands/skill.ts` and identify sync/check logic**

`skillCheck()` (line 112) loads lockfile and checks skill statuses.
`skillSync()` (line 138) calls `syncSkillsInventory()` from `openclaw-skills.ts`.

- [ ] **Step 2: Create `src/lib/skill-ops.ts`**

```typescript
// src/lib/skill-ops.ts
export type SkillCheckResult = {
  id: string;
  status: "active" | "inactive" | "failed";
  missingEnv?: string[];
  installError?: string;
};

export async function checkSkills(opts?: { projectDir?: string }): Promise<SkillCheckResult[]> {
  // Load lockfile, extract skill statuses
}

export async function syncSkills(): Promise<{ synced: number; total: number }> {
  // Call syncSkillsInventory(), return counts
}
```

- [ ] **Step 3: Write tests for `checkSkills()` and `syncSkills()`**

```typescript
// tests/skill-ops.test.ts
import { describe, it, expect } from "vitest";
import { checkSkills } from "../src/lib/skill-ops.js";

describe("skill-ops", () => {
  it("checkSkills returns array of SkillCheckResult", async () => {
    // Use fixture env vars for test data
    const results = await checkSkills();
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("status");
      expect(["active", "inactive", "failed"]).toContain(r.status);
    }
  });
});
```

Run: `npm test -- tests/skill-ops.test.ts`
Expected: PASS

- [ ] **Step 4: Refactor `src/commands/skill.ts` to use `src/lib/skill-ops.ts`**

- [ ] **Step 5: Run all tests, commit**

```bash
git add src/lib/skill-ops.ts tests/skill-ops.test.ts src/commands/skill.ts
git commit -m "refactor: extract skill check/sync into src/lib/skill-ops.ts"
```

---

### Task 5: Extract starter init into `src/lib/starter-ops.ts`

**Files:**
- Create: `src/lib/starter-ops.ts`
- Create: `tests/starter-ops.test.ts`
- Modify: `src/commands/starter.ts`

- [ ] **Step 1: Read `src/commands/starter.ts` and identify init logic**

`starterInit()` (line 245) loads starter, builds manifest, writes files. Internal helpers `buildStarterManifest()` (line 47) and `buildStarterReadme()` (line 71) are already pure.

- [ ] **Step 2: Create `src/lib/starter-ops.ts`**

```typescript
// src/lib/starter-ops.ts
export type InitResult = {
  projectDir: string;
  manifestPath: string;
  starterId: string;
  filesCreated: string[];
};

export async function initStarter(
  starterId: string,
  targetDir: string,
  opts?: { projectName?: string; force?: boolean }
): Promise<InitResult> {
  // Load starter, build manifest, write files
  // Throws on errors instead of process.exit
}

export function suggestStarters(query: string, starters: StarterDef[]): StarterDef[] {
  // Score and rank starters by query match
}
```

- [ ] **Step 3: Write tests for `suggestStarters()` and `initStarter()`**

```typescript
// tests/starter-ops.test.ts
import { describe, it, expect } from "vitest";
import { suggestStarters } from "../src/lib/starter-ops.js";

describe("starter-ops", () => {
  it("suggestStarters ranks by query relevance", () => {
    const starters = [
      { id: "saas", name: "SaaS Startup", tags: ["saas", "web"], entry_team: "dev-company", packs: ["dev-company"] },
      { id: "data", name: "Data Pipeline", tags: ["data", "etl"], entry_team: "data-team", packs: ["data-team"] },
    ] as any[];
    const results = suggestStarters("saas web app", starters);
    expect(results[0].id).toBe("saas");
  });
});
```

Run: `npm test -- tests/starter-ops.test.ts`
Expected: PASS

- [ ] **Step 4: Refactor `src/commands/starter.ts` to use `src/lib/starter-ops.ts`**

- [ ] **Step 5: Run all tests, commit**

```bash
git add src/lib/starter-ops.ts tests/starter-ops.test.ts src/commands/starter.ts
git commit -m "refactor: extract starter init/suggest into src/lib/starter-ops.ts"
```

---

### Task 6: Update root `tsconfig.json` for project references

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Add `composite` and `declaration` to root tsconfig**

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    // ... existing options
  }
}
```

- [ ] **Step 2: Run `npm run build` to verify compilation still works**

Run: `npm run build`
Expected: Compiles successfully with .d.ts files in dist/

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json
git commit -m "build: add composite and declaration for project references"
```

---

## Chunk 2: Dashboard Server Infrastructure

### Task 7: Scaffold `dashboard/` directory with package.json and tsconfigs

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/tsconfig.json` (frontend)
- Create: `dashboard/tsconfig.server.json` (server, references root)
- Create: `dashboard/vite.config.ts`
- Create: `dashboard/vitest.config.ts`

- [ ] **Step 1: Create `dashboard/package.json`**

```json
{
  "name": "openclaw-store-dashboard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently \"tsx watch server/index.ts\" \"vite\"",
    "build": "tsc -p tsconfig.server.json && vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "build:client": "vite build",
    "preview": "node dist/server/index.js"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/websocket": "^11.0.0",
    "@fastify/static": "^8.0.0",
    "@fastify/cors": "^10.0.0",
    "chokidar": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-query": "^5.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "concurrently": "^9.0.0",
    "jsdom": "^25.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.9.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `dashboard/tsconfig.server.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist/server",
    "rootDir": "server",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "composite": true
  },
  "include": ["server/**/*.ts"],
  "references": [{ "path": ".." }]
}
```

- [ ] **Step 3: Create `dashboard/tsconfig.json`** (frontend — Vite uses this)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "outDir": "dist/client",
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 4: Create `dashboard/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/client",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3456",
      "/ws": {
        target: "ws://localhost:3456",
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 5: Create `dashboard/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["server/__tests__/**/*.test.ts", "src/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
  },
});
```

- [ ] **Step 6: Run `cd dashboard && npm install`**

Run: `cd dashboard && npm install`
Expected: Dependencies installed

- [ ] **Step 7: Commit**

```bash
git add dashboard/package.json dashboard/tsconfig.json dashboard/tsconfig.server.json dashboard/vite.config.ts dashboard/vitest.config.ts dashboard/package-lock.json
git commit -m "feat(dashboard): scaffold dashboard directory with configs"
```

---

### Task 8: Build Fastify server entry + WebSocket + error handling

**Files:**
- Create: `dashboard/server/index.ts`
- Create: `dashboard/server/ws.ts`

- [ ] **Step 1: Create `dashboard/server/ws.ts`** — WebSocket broadcast utility

```typescript
// dashboard/server/ws.ts
import type { WebSocket } from "ws";

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
}

export function broadcast(event: { type: string; [key: string]: unknown }): void {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}
```

- [ ] **Step 2: Create `dashboard/server/index.ts`** — Fastify entry

```typescript
// dashboard/server/index.ts
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { addClient } from "./ws.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(opts: { host?: string; port?: number } = {}) {
  const host = opts.host ?? "0.0.0.0";
  const port = opts.port ?? 3456;
  const isDev = process.env.NODE_ENV !== "production";

  const app = Fastify({ logger: false });

  // CORS in dev mode only
  if (isDev) {
    await app.register(fastifyCors, { origin: true });
  }

  // WebSocket
  await app.register(fastifyWebsocket);
  app.get("/ws", { websocket: true }, (socket) => {
    addClient(socket);
  });

  // Error handler
  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode ?? 500;
    reply.status(status).send({
      error: error.message,
      code: error.code ?? "INTERNAL_ERROR",
      details: error.validation ?? {},
    });
  });

  // Static files in production
  if (!isDev) {
    await app.register(fastifyStatic, {
      root: path.join(__dirname, "../client"),
      wildcard: false,
    });
    // SPA fallback (only for non-API routes)
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.status(404).send({ error: "Not found", code: "NOT_FOUND", details: {} });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  // Health endpoint
  app.get("/api/ping", async () => ({ status: "ok" }));

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ host, port });
  console.log(`Dashboard running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);

  return app;
}

// Direct execution
const __filename_check = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename_check) {
  createServer();
}
```

- [ ] **Step 3: Verify server starts**

Run: `cd dashboard && npx tsx server/index.ts`
Expected: "Dashboard running at http://localhost:3456" — Ctrl+C to stop

- [ ] **Step 4: Verify `/api/ping` responds**

Run: `curl http://localhost:3456/api/ping`
Expected: `{"status":"ok"}`

- [ ] **Step 5: Commit**

```bash
git add dashboard/server/index.ts dashboard/server/ws.ts
git commit -m "feat(dashboard): add Fastify server with WebSocket support"
```

---

### Task 9: Build file watcher

**Files:**
- Create: `dashboard/server/watcher.ts`

- [ ] **Step 1: Create `dashboard/server/watcher.ts`**

```typescript
// dashboard/server/watcher.ts
import { watch, type FSWatcher } from "chokidar";
import { broadcast } from "./ws.js";
import {
  resolveStoreRuntimeFile,
  resolveStoreSkillsIndexFile,
  resolveStoreWorkspacesRoot,
} from "../../dist/lib/paths.js";
import { loadRuntimeState } from "../../dist/lib/runtime.js";
import path from "node:path";

let watcher: FSWatcher | null = null;
const debounceTimers = new Map<string, NodeJS.Timeout>();

function debounced(key: string, fn: () => void, ms = 500): void {
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    fn();
  }, ms));
}

export async function startWatcher(): Promise<FSWatcher> {
  const runtimeFile = resolveStoreRuntimeFile();
  const skillsIndexFile = resolveStoreSkillsIndexFile();
  const workspacesRoot = resolveStoreWorkspacesRoot();

  // Collect known project dirs
  const state = await loadRuntimeState();
  const projectDirs = state.projects.map((p) => p.project_dir).filter(Boolean);

  const watchPaths = [
    runtimeFile,
    skillsIndexFile,
    path.join(workspacesRoot, "**/shared/memory/*.md"),
    ...projectDirs.flatMap((dir) => [
      path.join(dir, "openclaw-store.yaml"),
      path.join(dir, "openclaw-store.lock"),
    ]),
  ];

  watcher = watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  watcher.on("change", (filePath) => {
    if (filePath === runtimeFile) {
      debounced("projects", () => {
        broadcast({ type: "projects:changed" });
        // Re-initialize watcher to pick up new project dirs
        stopWatcher().then(() => startWatcher());
      });
    } else if (filePath === skillsIndexFile) {
      debounced("skills", () => broadcast({ type: "skills:changed" }));
    } else if (filePath.endsWith("openclaw-store.yaml")) {
      debounced("manifest:" + filePath, () =>
        broadcast({ type: "manifest:changed", projectDir: path.dirname(filePath) })
      );
    } else if (filePath.endsWith("openclaw-store.lock")) {
      debounced("lockfile:" + filePath, () =>
        broadcast({ type: "lockfile:changed", projectDir: path.dirname(filePath) })
      );
    } else if (filePath.includes("/shared/memory/")) {
      const parts = filePath.split(path.sep);
      const memIdx = parts.indexOf("memory");
      const sharedIdx = parts.indexOf("shared");
      if (sharedIdx >= 2) {
        const teamId = parts[sharedIdx - 1];
        const projectId = parts[sharedIdx - 2];
        debounced(`memory:${projectId}:${teamId}`, () =>
          broadcast({
            type: "memory:changed",
            projectId,
            teamId,
            file: parts[memIdx + 1],
          })
        );
      }
    }
  });

  return watcher;
}

export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
}
```

- [ ] **Step 2: Integrate watcher into server startup**

Add to `dashboard/server/index.ts` after `app.listen()`:
```typescript
import { startWatcher, stopWatcher } from "./watcher.js";

// In createServer(), after app.listen():
await startWatcher();

// In shutdown handler:
const shutdown = async () => {
  await stopWatcher();
  await app.close();
  process.exit(0);
};
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/server/watcher.ts dashboard/server/index.ts
git commit -m "feat(dashboard): add file watcher with debounced WS events"
```

---

### Task 10: Build store service bridge

**Files:**
- Create: `dashboard/server/services/store.ts`

- [ ] **Step 1: Create the store service bridge**

This module wraps `src/lib/` imports into clean async functions for route handlers. Read the existing loader, runtime, and schema modules, then create thin wrappers.

```typescript
// dashboard/server/services/store.ts
// Re-exports and wraps src/lib/ functions for use by route handlers.
// Import paths reference the compiled dist/ output via project references.

import { loadRuntimeState } from "../../../dist/lib/runtime.js";
import {
  loadAllAgents, loadAllTeams, loadAllSkills, loadAllPacks,
  loadAllStarters, loadAgent, loadTeam, loadSkill,
  loadStarter, loadManifest, loadLockfile, writeManifest,
  loadDemoProject,
} from "../../../dist/lib/loader.js";
import { resolveSharedMemoryDir } from "../../../dist/lib/paths.js";
import { runChecks } from "../../../dist/lib/doctor.js";
import { computeDiff } from "../../../dist/lib/diff.js";
import { runHeadlessInstall } from "../../../dist/lib/install-headless.js";
import { checkSkills, syncSkills } from "../../../dist/lib/skill-ops.js";
import { initStarter, suggestStarters } from "../../../dist/lib/starter-ops.js";
import fs from "node:fs/promises";
import path from "node:path";

export const store = {
  // Projects
  getProjects: () => loadRuntimeState(),
  getProject: async (id: string) => {
    const state = await loadRuntimeState();
    const project = state.projects.find((p) => p.id === id);
    if (!project) return null;
    const lockfile = project.project_dir
      ? await loadLockfile(project.project_dir)
      : null;
    return { ...project, lockfile };
  },

  // Kanban (reads shared memory markdown)
  // NOTE: Verify that resolveSharedMemoryDir(projectId, teamId) returns
  // the correct path format. Check src/lib/paths.ts — it expects the
  // store__<project>__<team> scoped workspace path under workspacesRoot.
  getKanban: async (projectId: string, teamId: string) => {
    const dir = resolveSharedMemoryDir(projectId, teamId);
    const filePath = path.join(dir, "kanban.md");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { content, raw: true }; // Frontend parses markdown
    } catch {
      return { content: null, raw: true };
    }
  },

  // Task log
  getTaskLog: async (projectId: string, teamId: string) => {
    const dir = resolveSharedMemoryDir(projectId, teamId);
    const filePath = path.join(dir, "tasks-log.md");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { content, raw: true };
    } catch {
      return { content: null, raw: true };
    }
  },

  // Teams & Agents
  getTeams: () => loadAllTeams(),
  getTeam: (id: string) => loadTeam(id),
  getAgents: () => loadAllAgents(),
  getAgent: (id: string) => loadAgent(id),

  // Skills
  getSkills: () => loadAllSkills(),
  checkSkills: (opts?: { projectDir?: string }) => checkSkills(opts),
  syncSkills: () => syncSkills(),

  // Health
  getHealth: (opts?: { projectDir?: string }) => runChecks(opts),

  // Starters
  getStarters: () => loadAllStarters(),
  getStarter: async (id: string) => {
    const starter = await loadStarter(id);
    let card: string | null = null;
    try {
      const demo = await loadDemoProject(id);
      card = demo.summary ?? null;
    } catch { /* no demo card */ }
    return { ...starter, card };
  },
  initStarter,
  suggestStarters,

  // Manifest
  getManifest: (projectDir?: string) => loadManifest(projectDir),
  updateManifest: async (manifest: unknown, projectDir?: string) => {
    // Validate against Manifest Zod schema before writing
    const { ManifestSchema } = await import("../../../dist/lib/schema.js");
    const validated = ManifestSchema.parse(manifest);
    return writeManifest(validated, projectDir);
  },

  // Diff
  getDiff: (opts?: { projectDir?: string }) => computeDiff(opts),

  // Install
  install: runHeadlessInstall,
};
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/server/services/store.ts
git commit -m "feat(dashboard): add store service bridge"
```

---

### Task 11: Build REST API routes

**Files:**
- Create: `dashboard/server/routes/projects.ts`
- Create: `dashboard/server/routes/agents.ts`
- Create: `dashboard/server/routes/teams.ts`
- Create: `dashboard/server/routes/skills.ts`
- Create: `dashboard/server/routes/health.ts`
- Create: `dashboard/server/routes/starters.ts`
- Create: `dashboard/server/routes/manifest.ts`
- Create: `dashboard/server/routes/diff.ts`
- Modify: `dashboard/server/index.ts` (register routes)

- [ ] **Step 1: Create each route file**

Each route file exports an async Fastify plugin function. Example for `projects.ts`:

```typescript
// dashboard/server/routes/projects.ts
import type { FastifyPluginAsync } from "fastify";
import { store } from "../services/store.js";

const projectRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/projects", async () => {
    const state = await store.getProjects();
    return state.projects;
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const project = await store.getProject(req.params.id);
    if (!project) return reply.status(404).send({ error: "Project not found", code: "NOT_FOUND", details: {} });
    return project;
  });

  app.get<{ Params: { id: string; teamId: string } }>(
    "/api/projects/:id/kanban/:teamId",
    async (req) => store.getKanban(req.params.id, req.params.teamId)
  );

  app.get<{ Params: { id: string; teamId: string } }>(
    "/api/projects/:id/log/:teamId",
    async (req) => store.getTaskLog(req.params.id, req.params.teamId)
  );
};

export default projectRoutes;
```

Follow the same pattern for all route files. Each route maps to a `store.*` call.

For `manifest.ts`, include the install mutex:

```typescript
// dashboard/server/routes/manifest.ts
let installRunning = false;

app.post("/api/install", async (req, reply) => {
  if (installRunning) {
    return reply.status(409).send({
      error: "Install already running",
      code: "INSTALL_CONFLICT",
      details: {},
    });
  }
  installRunning = true;
  try {
    const result = await store.install({
      projectDir: (req.body as any)?.projectDir,
      onProgress: (p) => broadcast({ type: "install:progress", ...p }),
    });
    return result;
  } finally {
    installRunning = false;
  }
});
```

- [ ] **Step 2: Register all routes in `server/index.ts`**

```typescript
import projectRoutes from "./routes/projects.js";
import agentRoutes from "./routes/agents.js";
import teamRoutes from "./routes/teams.js";
import skillRoutes from "./routes/skills.js";
import healthRoutes from "./routes/health.js";
import starterRoutes from "./routes/starters.js";
import manifestRoutes from "./routes/manifest.js";
import diffRoutes from "./routes/diff.js";

// In createServer():
await app.register(projectRoutes);
await app.register(agentRoutes);
await app.register(teamRoutes);
await app.register(skillRoutes);
await app.register(healthRoutes);
await app.register(starterRoutes);
await app.register(manifestRoutes);
await app.register(diffRoutes);
```

- [ ] **Step 3: Test API manually**

Start server, verify all GET endpoints return data:
```bash
curl http://localhost:3456/api/projects
curl http://localhost:3456/api/teams
curl http://localhost:3456/api/agents
curl http://localhost:3456/api/skills
curl http://localhost:3456/api/health
curl http://localhost:3456/api/starters
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/server/routes/
git commit -m "feat(dashboard): add REST API routes for all panels"
```

---

### Task 12: Add server tests

**Files:**
- Create: `dashboard/server/__tests__/routes.test.ts`

- [ ] **Step 1: Create route tests using Fastify's `inject()`**

```typescript
// dashboard/server/__tests__/routes.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../index.js";
import type { FastifyInstance } from "fastify";

describe("API routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ port: 0 }); // random port
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/ping returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ping" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/projects returns array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /api/teams returns array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/teams" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /api/agents returns array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /api/projects/nonexistent returns 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd dashboard && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add dashboard/server/__tests__/
git commit -m "test(dashboard): add API route tests"
```

---

## Chunk 3: Frontend Core — React Setup, Hooks, Layout Shell

### Task 13: Scaffold React app with Vite

**Files:**
- Create: `dashboard/index.html`
- Create: `dashboard/src/main.tsx`
- Create: `dashboard/src/App.tsx`
- Create: `dashboard/src/lib/types.ts`

- [ ] **Step 1: Create `dashboard/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>openclaw-store</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `dashboard/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 3: Create `dashboard/src/App.tsx`** (layout shell with tabs)

```tsx
import { Routes, Route, NavLink } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  const tabs = [
    { to: "/", label: "Overview" },
    { to: "/projects", label: "Projects" },
    { to: "/starters", label: "Starters" },
    { to: "/config", label: "Config" },
  ];

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Top nav bar */}
      <nav style={{
        display: "flex", alignItems: "center", gap: 16,
        background: "#161b22", padding: "8px 16px",
        borderBottom: "1px solid #30363d",
      }}>
        <span style={{ fontWeight: "bold", color: "#f0f6fc", marginRight: 16 }}>
          ⬡ openclaw-store
        </span>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            style={({ isActive }) => ({
              padding: "4px 12px", borderRadius: 4, textDecoration: "none",
              color: isActive ? "#58a6ff" : "#8b949e",
              background: isActive ? "#1f6feb33" : "transparent",
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {/* Route content */}
      <main style={{ padding: 12 }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<div>Projects (TODO)</div>} />
          <Route path="/starters" element={<div>Starters (TODO)</div>} />
          <Route path="/config" element={<div>Config (TODO)</div>} />
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create `dashboard/src/pages/Dashboard.tsx`** (placeholder)

```tsx
export function Dashboard() {
  return <div style={{ color: "#8b949e" }}>Dashboard overview — panels coming next.</div>;
}
```

- [ ] **Step 5: Create `dashboard/src/lib/types.ts`**

```typescript
// Re-export Zod inferred types from store schema for frontend use.
// These types are used by API hooks to type responses.
// In production, these would come from the schema. For now, define the
// API response shapes the frontend needs.

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
  type: "add" | "remove" | "change";
  kind: "pack" | "skill";
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

// NOTE: `install:progress` is broadcast by the install route handler (Task 11).
// Also update the spec's WS events table to include this event.
```

- [ ] **Step 6: Verify Vite starts and shows the app**

Run: `cd dashboard && npx vite`
Open: http://localhost:5173
Expected: Top nav bar with tabs, "Dashboard overview" placeholder text

- [ ] **Step 7: Commit**

```bash
git add dashboard/index.html dashboard/src/
git commit -m "feat(dashboard): scaffold React app with routing and layout shell"
```

---

### Task 14: Build API hooks and WebSocket hook

**Files:**
- Create: `dashboard/src/hooks/useApi.ts`
- Create: `dashboard/src/hooks/useWs.ts`

- [ ] **Step 1: Create `dashboard/src/hooks/useApi.ts`**

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project, Agent, Team, Skill, Finding, Starter, DiffEntry, SkillCheckResult } from "../lib/types";

const BASE = "/api";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function useProjects() {
  return useQuery<Project[]>({ queryKey: ["projects"], queryFn: () => fetchJson("/projects") });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ["projects", id], queryFn: () => fetchJson<Project & { lockfile: unknown }>(`/projects/${id}`) });
}

export function useKanban(projectId: string, teamId: string) {
  return useQuery({ queryKey: ["kanban", projectId, teamId], queryFn: () => fetchJson<{ content: string | null }>(`/projects/${projectId}/kanban/${teamId}`) });
}

export function useTaskLog(projectId: string, teamId: string) {
  return useQuery({ queryKey: ["log", projectId, teamId], queryFn: () => fetchJson<{ content: string | null }>(`/projects/${projectId}/log/${teamId}`) });
}

export function useTeams() {
  return useQuery<Team[]>({ queryKey: ["teams"], queryFn: () => fetchJson("/teams") });
}

export function useAgents() {
  return useQuery<Agent[]>({ queryKey: ["agents"], queryFn: () => fetchJson("/agents") });
}

export function useTeam(id: string) {
  return useQuery<Team>({ queryKey: ["teams", id], queryFn: () => fetchJson(`/teams/${id}`), enabled: !!id });
}

export function useAgent(id: string) {
  return useQuery<Agent>({ queryKey: ["agents", id], queryFn: () => fetchJson(`/agents/${id}`), enabled: !!id });
}

export function useSkills() {
  return useQuery<Skill[]>({ queryKey: ["skills"], queryFn: () => fetchJson("/skills") });
}

export function useSkillCheck() {
  return useQuery<SkillCheckResult[]>({ queryKey: ["skillCheck"], queryFn: () => fetchJson("/skills/check") });
}

export function useHealth() {
  return useQuery<Finding[]>({ queryKey: ["health"], queryFn: () => fetchJson("/health") });
}

export function useStarters() {
  return useQuery<Starter[]>({ queryKey: ["starters"], queryFn: () => fetchJson("/starters") });
}

export function useStarter(id: string) {
  return useQuery<Starter>({ queryKey: ["starters", id], queryFn: () => fetchJson(`/starters/${id}`), enabled: !!id });
}

export function useManifest() {
  return useQuery({ queryKey: ["manifest"], queryFn: () => fetchJson("/manifest") });
}

export function useDiff() {
  return useQuery<DiffEntry[]>({ queryKey: ["diff"], queryFn: () => fetchJson("/diff") });
}

export function useSaveManifest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (manifest: unknown) =>
      fetch(`${BASE}/manifest`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manifest) }).then((r) => {
        if (!r.ok) return r.json().then((b: any) => { throw new Error(b.error); });
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manifest"] });
      qc.invalidateQueries({ queryKey: ["diff"] });
    },
  });
}

export function useInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { projectDir?: string }) =>
      fetch(`${BASE}/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useInitStarter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; targetDir: string; projectName?: string }) =>
      fetch(`${BASE}/starters/${id}/init`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useSyncSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch(`${BASE}/skills/sync`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skillCheck"] });
    },
  });
}
```

- [ ] **Step 2: Create `dashboard/src/hooks/useWs.ts`**

```tsx
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WsEvent } from "../lib/types";

export function useWs() {
  const qc = useQueryClient();
  const [connectAttempt, setConnectAttempt] = useState(0);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(url);

    ws.onmessage = (e) => {
      try {
        const event: WsEvent = JSON.parse(e.data);
        switch (event.type) {
          case "projects:changed":
            qc.invalidateQueries({ queryKey: ["projects"] });
            break;
          case "manifest:changed":
            qc.invalidateQueries({ queryKey: ["manifest"] });
            qc.invalidateQueries({ queryKey: ["diff"] });
            break;
          case "lockfile:changed":
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["agents"] });
            qc.invalidateQueries({ queryKey: ["skills"] });
            break;
          case "skills:changed":
            qc.invalidateQueries({ queryKey: ["skills"] });
            break;
          case "memory:changed":
            qc.invalidateQueries({ queryKey: ["kanban", event.projectId, event.teamId] });
            qc.invalidateQueries({ queryKey: ["log", event.projectId, event.teamId] });
            break;
          case "install:progress":
            // Install progress events are handled by UI components listening via onMessage
            break;
        }
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = () => {
      // Reconnect after 3 seconds by incrementing state (triggers effect re-run)
      setTimeout(() => setConnectAttempt((n) => n + 1), 3000);
    };

    return () => {
      ws.close();
    };
  }, [qc, connectAttempt]);
}
```

- [ ] **Step 3: Wire `useWs()` into `App.tsx`**

```tsx
import { useWs } from "./hooks/useWs";

export function App() {
  useWs(); // establishes WebSocket connection
  // ... rest of App
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/
git commit -m "feat(dashboard): add API hooks and WebSocket auto-invalidation"
```

---

## Chunk 4: Frontend Panels

### Task 15: Build overview grid components

Build all 10 panel components and wire them into the Dashboard overview page. Each component is self-contained, uses the API hooks from Task 14, and follows the dark theme from the mockup.

**Files:**
- Create: `dashboard/src/components/ProjectCard.tsx`
- Create: `dashboard/src/components/AgentList.tsx`
- Create: `dashboard/src/components/SkillTable.tsx`
- Create: `dashboard/src/components/HealthChecks.tsx`
- Create: `dashboard/src/components/KanbanBoard.tsx`
- Create: `dashboard/src/components/ActivityFeed.tsx`
- Create: `dashboard/src/components/CostTracker.tsx`
- Create: `dashboard/src/components/VirtualOffice.tsx`
- Create: `dashboard/src/components/DiffView.tsx`
- Create: `dashboard/src/components/ManifestForm.tsx`
- Create: `dashboard/src/components/TeamGraph.tsx`
- Modify: `dashboard/src/pages/Dashboard.tsx`

Each component should:
- Accept relevant data via props (fetched by parent page)
- Use inline styles with the dark theme colors from the mockup (#0d1117 bg, #161b22 cards, #30363d borders, #f0f6fc text, #58a6ff blue, #3fb950 green, #d29922 yellow, #f85149 red, #a371f7 purple)
- Handle loading/error states from React Query
- Be under 150 lines each

- [ ] **Step 1: Create all panel components**

Build each component using the API hooks. For example, `AgentList.tsx`:

```tsx
import type { Team } from "../lib/types";

const ROLE_COLORS: Record<string, string> = {
  lead: "#a371f7", specialist: "#3fb950", reviewer: "#d29922",
};

export function AgentList({ teams }: { teams: Team[] }) {
  return (
    <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 12 }}>
      <div style={{ color: "#f0f6fc", fontWeight: "bold", marginBottom: 10 }}>
        👥 Agents · {teams.reduce((s, t) => s + t.members.length, 0)}
      </div>
      {teams.map((team) => (
        <div key={team.id} style={{ marginBottom: 8 }}>
          <div style={{ color: "#58a6ff", fontSize: 10, fontWeight: "bold", marginBottom: 4 }}>
            {team.name?.toUpperCase() ?? team.id.toUpperCase()}
          </div>
          <div style={{ paddingLeft: 8, borderLeft: "2px solid #1f6feb33" }}>
            {team.members.map((m) => (
              <div key={m.agent} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span style={{ color: ROLE_COLORS[m.role] ?? "#8b949e" }}>●</span>
                <span style={{ color: "#c9d1d9", fontSize: 11 }}>{m.agent}</span>
                <span style={{ color: "#8b949e", fontSize: 9, background: "#21262d", padding: "0 4px", borderRadius: 3 }}>
                  {m.role}{m.entry_point ? " · entry" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

Follow the same pattern for all components. `VirtualOffice.tsx` renders team rooms with agent avatars using CSS. `CostTracker.tsx` shows placeholder dashes. `KanbanBoard.tsx` parses markdown content into columns. `TeamGraph.tsx` renders the team delegation graph (from→to edges) as a simple SVG node-and-arrow diagram — used in the Projects detail page to visualize team structure.

- [ ] **Step 2: Update `Dashboard.tsx` to compose the grid**

```tsx
import { useProjects, useTeams, useHealth, useSkills, useKanban } from "../hooks/useApi";
import { AgentList } from "../components/AgentList";
import { SkillTable } from "../components/SkillTable";
import { HealthChecks } from "../components/HealthChecks";
import { KanbanBoard } from "../components/KanbanBoard";
import { VirtualOffice } from "../components/VirtualOffice";
import { ActivityFeed } from "../components/ActivityFeed";
import { CostTracker } from "../components/CostTracker";
import { useState } from "react";

export function Dashboard() {
  const { data: projects } = useProjects();
  const { data: teams } = useTeams();
  const { data: health } = useHealth();
  const { data: skills } = useSkills();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // Empty state
  if (projects && projects.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#8b949e" }}>
        <h2 style={{ color: "#f0f6fc" }}>Welcome to openclaw-store</h2>
        <p>No projects installed yet.</p>
        <a href="/starters" style={{ color: "#58a6ff" }}>Browse starters to get started →</a>
      </div>
    );
  }

  return (
    <div>
      {/* Project selector */}
      {projects && projects.length > 0 && (
        <select
          value={selectedProject ?? projects[0].id}
          onChange={(e) => setSelectedProject(e.target.value)}
          style={{ background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d", borderRadius: 4, padding: "4px 8px", marginBottom: 12 }}
        >
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id}</option>)}
        </select>
      )}

      {/* Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 300px 280px",
        gridTemplateRows: "auto auto auto",
        gap: 8,
      }}>
        {/* Row 1-2, Col 1: Kanban */}
        <div style={{ gridRow: "span 2" }}>
          <KanbanBoard projectId={selectedProject ?? projects?.[0]?.id ?? ""} teamId={projects?.[0]?.entry_team ?? ""} />
        </div>
        {/* Row 1, Col 2: Agents */}
        {teams && <AgentList teams={teams} />}
        {/* Row 1, Col 3: Cost + Health stacked */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CostTracker />
          {health && <HealthChecks findings={health} />}
        </div>
        {/* Row 2, Col 2: Skills */}
        {skills && <SkillTable skills={skills} />}
        {/* Row 2, Col 3: Activity */}
        <ActivityFeed />
        {/* Row 3: Virtual Office (full width) */}
        <div style={{ gridColumn: "span 3" }}>
          {teams && <VirtualOffice teams={teams} />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Test the full dashboard visually**

Run both server and frontend:
```bash
# Terminal 1: cd dashboard && npx tsx server/index.ts
# Terminal 2: cd dashboard && npx vite
```
Open http://localhost:5173 — verify all panels render

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/ dashboard/src/pages/Dashboard.tsx
git commit -m "feat(dashboard): add all 10 panel components and overview grid"
```

---

### Task 16: Build remaining pages (Projects, Starters, Config)

**Files:**
- Modify: `dashboard/src/pages/Project.tsx` (was TODO placeholder)
- Modify: `dashboard/src/pages/Starters.tsx`
- Modify: `dashboard/src/pages/Config.tsx`

- [ ] **Step 1: Build Projects page**

Project list with expand/collapse. Selected project shows detail panels (agents, kanban, task log).

- [ ] **Step 2: Build Starters page**

Grid of starter cards with search input. Each card shows name, description, tags, required APIs. "Init" button triggers `POST /api/starters/:id/init`.

- [ ] **Step 3: Build Config page**

Form-based manifest editor. Show current manifest as editable fields (packs, skills, overrides). Diff preview panel. Install button with progress display via WS events.

- [ ] **Step 4: Test all pages**

Navigate between all tabs, verify data loads and interactions work.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/
git commit -m "feat(dashboard): add Projects, Starters, and Config pages"
```

---

## Chunk 5: CLI Integration & Polish

### Task 17: Register `dashboard` CLI command

**Files:**
- Create: `src/commands/dashboard.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create `src/commands/dashboard.ts`**

```typescript
// src/commands/dashboard.ts
export async function runDashboard(opts: { port?: number; host?: string }): Promise<void> {
  // Dynamic import from dashboard's compiled output
  const { createServer } = await import("../../dashboard/dist/server/index.js");
  await createServer({ port: opts.port ?? 3456, host: opts.host ?? "0.0.0.0" });
}
```

- [ ] **Step 2: Register in `src/cli.ts`**

Add after the existing `doctor` command registration:

```typescript
program
  .command("dashboard")
  .description("Start the web dashboard")
  .option("--port <port>", "Server port", "3456")
  .option("--host <host>", "Bind host", "0.0.0.0")
  .action(async (opts) => {
    const { runDashboard } = await import("./commands/dashboard.js");
    await runDashboard({ port: parseInt(opts.port), host: opts.host });
  });
```

- [ ] **Step 3: Build both projects and test**

```bash
npm run build                    # Build root (src/lib + src/commands)
cd dashboard && npm run build    # Build dashboard
cd .. && openclaw-store dashboard  # Should start the dashboard
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/dashboard.ts src/cli.ts
git commit -m "feat: add 'openclaw-store dashboard' CLI command"
```

---

### Task 18: Add `.gitignore` entries and documentation

**Files:**
- Modify: `.gitignore`
- Create: `docs/remote-access.md`

- [ ] **Step 1: Add gitignore entries**

```
# Dashboard
dashboard/dist/
dashboard/node_modules/
*.tsbuildinfo
.superpowers/
```

- [ ] **Step 2: Create `docs/remote-access.md`**

Document the three remote access methods (Cloudflare Tunnel, Tailscale, SSH tunnel) with copy-paste commands as specified in the design spec.

- [ ] **Step 3: Commit**

```bash
git add .gitignore docs/remote-access.md
git commit -m "docs: add remote access guide and gitignore entries"
```

---

### Task 19: Final integration test

- [ ] **Step 1: Clean build from scratch**

```bash
npm run build
cd dashboard && npm install && npm run build
```

- [ ] **Step 2: Start dashboard and verify all features**

```bash
openclaw-store dashboard
```

Open http://localhost:3456 and verify:
- All 4 tabs render
- Overview grid shows all panels
- Project selector works
- Agents grouped by team
- Skills show status
- Health checks display
- Virtual office shows team rooms
- Cost tracker shows placeholder
- Activity feed updates on file changes
- Config page loads manifest
- Starters page lists starters

- [ ] **Step 3: Test from another device on LAN**

Open `http://<machine-ip>:3456` from a phone or another computer on the same WiFi.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(dashboard): complete v1 dashboard with all panels"
```
