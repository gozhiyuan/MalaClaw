import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveManifest } from "../src/lib/resolver.js";

describe("resolveManifest", () => {
  it("resolves all agents from a single-team pack", async () => {
    const result = await resolveManifest({
      version: 1,
      packs: [{ id: "dev-company" }],
      skills: [],
    }, { projectDir: "/tmp/acme-web" });
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0].agents.length).toBeGreaterThanOrEqual(7);
    const agentIds = result.packs[0].agents.map((a) => a.agentId);
    expect(agentIds.some((id) => id === "store__acme-web__dev-company__pm")).toBe(true);
    expect(agentIds.some((id) => id === "store__acme-web__dev-company__tech-lead")).toBe(true);
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
    }, { projectDir: "/tmp/acme-web" });
    expect(result.lockfile.version).toBe(1);
    expect(result.lockfile.project?.id).toBe("acme-web");
    expect(result.lockfile.packs).toHaveLength(1);
    expect(result.lockfile.packs![0].project_id).toBe("acme-web");
    expect(result.lockfile.packs![0].agents.length).toBeGreaterThanOrEqual(7);
  });

  describe("multi-team pack", () => {
    const FIXTURES_PACKS_DIR = path.resolve(fileURLToPath(import.meta.url), "../fixtures/packs");

    it("resolves multiple teams from a multi-team pack", async () => {
      process.env.OPENCLAW_STORE_PACKS_DIR = FIXTURES_PACKS_DIR;
      try {
        const result = await resolveManifest({
          version: 1,
          packs: [{ id: "multi-team-fixture" }],
          skills: [],
        });
        expect(result.packs.length).toBeGreaterThanOrEqual(2);
        const teamIds = result.packs.map((p) => p.teamDef.id);
        expect(teamIds).toContain("dev-company");
        expect(teamIds).toContain("research-lab");
      } finally {
        delete process.env.OPENCLAW_STORE_PACKS_DIR;
      }
    });
  });
});
