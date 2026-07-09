import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveDashboardExtensionSpecs,
  diagnoseDashboardExtension,
  dashboardConfigPath,
} from "../src/lib/dashboard-extensions.js";

const tempDirs: string[] = [];
const savedEnv = {
  MALACLAW_DIR: process.env.MALACLAW_DIR,
  MALACLAW_DASHBOARD_SERVER_EXTENSIONS: process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS,
};

async function makeDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-dashext-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveDashboardExtensionSpecs", () => {
  it("merges env specs and dashboard.yaml, env first, deduped", async () => {
    const dir = await makeDir();
    process.env.MALACLAW_DIR = dir;
    process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS = "/env/a.js, /both/x.js";
    await fs.writeFile(
      path.join(dir, "dashboard.yaml"),
      "dashboard:\n  server_extensions:\n    - /cfg/b.js\n    - /both/x.js\n",
      "utf-8",
    );
    expect(dashboardConfigPath()).toBe(path.join(dir, "dashboard.yaml"));
    const specs = await resolveDashboardExtensionSpecs();
    expect(specs).toEqual([
      { spec: "/env/a.js", source: "env" },
      { spec: "/both/x.js", source: "env" },
      { spec: "/cfg/b.js", source: "config" },
    ]);
  });

  it("tolerates missing or malformed config files", async () => {
    const dir = await makeDir();
    process.env.MALACLAW_DIR = dir;
    delete process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS;
    expect(await resolveDashboardExtensionSpecs()).toEqual([]);
    await fs.writeFile(path.join(dir, "dashboard.yaml"), "dashboard: [not: valid", "utf-8");
    expect(await resolveDashboardExtensionSpecs()).toEqual([]);
  });
});

describe("diagnoseDashboardExtension", () => {
  it("reports missing files with a build hint", async () => {
    const diagnosis = await diagnoseDashboardExtension({ spec: "/nonexistent/ext.js", source: "config" });
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.problems[0]).toContain("file not found");
    expect(diagnosis.problems[0]).toContain("build the extension");
  });

  it("accepts a valid factory module and reports its id", async () => {
    const dir = await makeDir();
    const file = path.join(dir, "good-ext.mjs");
    await fs.writeFile(file, `
export function createDashboardServerExtension(host) {
  return { id: "test-ext", routes: async (app) => {} };
}
`, "utf-8");
    const diagnosis = await diagnoseDashboardExtension({ spec: file, source: "env" });
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.id).toBe("test-ext");
  });

  it("reports shape problems for invalid extensions", async () => {
    const dir = await makeDir();
    const noRoutes = path.join(dir, "no-routes.mjs");
    await fs.writeFile(noRoutes, `export default { id: "broken" };`, "utf-8");
    const diagnosis = await diagnoseDashboardExtension({ spec: noRoutes, source: "env" });
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.problems.join()).toContain("routes");

    const throws = path.join(dir, "throws.mjs");
    await fs.writeFile(throws, `export function createDashboardServerExtension() { throw new Error("boom"); }`, "utf-8");
    const thrown = await diagnoseDashboardExtension({ spec: throws, source: "env" });
    expect(thrown.ok).toBe(false);
    expect(thrown.problems[0]).toContain("boom");
  });
});
