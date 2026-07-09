import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { loadDashboardServerExtensions } from "./index.js";
import { createServer } from "../index.js";

const tempDirs: string[] = [];
const originalSpecs = process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS;

afterEach(async () => {
  if (originalSpecs === undefined) delete process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS;
  else process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS = originalSpecs;
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

async function writeExtensionModule(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(process.cwd(), ".tmp-dashboard-extension-"));
  tempDirs.push(dir);
  const file = path.join(dir, "extension.mjs");
  await fs.writeFile(file, source, "utf-8");
  return file;
}

const host = {
  loadFlowState: async () => ({}),
  logsDir: () => "",
  approveAllFlow: async () => ({}),
  approveFlow: async () => ({}),
  summarizeUsage: async () => ({}),
};

describe("dashboard server extension loader", () => {
  it("loads an installed extension factory from a filesystem path", async () => {
    const file = await writeExtensionModule(`
      export function createDashboardServerExtension(host) {
        if (!host.loadFlowState) throw new Error("missing host");
        return { id: "fixture", routes: async (app) => {
          app.get("/api/fixture-extension", async () => ({ ok: true }));
        } };
      }
    `);
    process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS = file;

    const extensions = await loadDashboardServerExtensions(host);
    expect(extensions.map((extension) => extension.id)).toEqual(["fixture"]);
  });

  it("registers loaded extension routes when the dashboard starts", async () => {
    const file = await writeExtensionModule(`
      export default function createDashboardServerExtension() {
        return { id: "fixture", routes: async (app) => {
          app.get("/api/fixture-extension", async () => ({ ok: true, source: "external" }));
        } };
      }
    `);
    process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS = file;
    const app = await createServer({ port: 0 });
    try {
      const res = await app.inject({ method: "GET", url: "/api/fixture-extension" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, source: "external" });
    } finally {
      await app.close();
    }
  });
});
