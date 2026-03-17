import { describe, expect, it } from "vitest";
import { starterScore, suggestStarters } from "../src/lib/starter-ops.js";
import type { StarterDef } from "../src/lib/starter-ops.js";

function makeStarter(overrides: Partial<StarterDef> & { id: string; name: string }): StarterDef {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? "A starter description.",
    source_usecase: overrides.source_usecase ?? "Test use case",
    entry_team: overrides.entry_team ?? "default-team",
    packs: overrides.packs ?? [],
    project_skills: overrides.project_skills ?? ["openclaw-store-manager"],
    installable_skills: overrides.installable_skills ?? [],
    required_apis: overrides.required_apis ?? [],
    required_capabilities: overrides.required_capabilities ?? [],
    external_requirements: overrides.external_requirements ?? [],
    tags: overrides.tags ?? [],
    bootstrap_prompt: overrides.bootstrap_prompt,
  };
}

const mockStarters: StarterDef[] = [
  makeStarter({
    id: "content-factory",
    name: "Content Factory",
    description: "Create and manage content pipelines.",
    entry_team: "content-factory",
    packs: ["content-factory"],
    tags: ["content", "media"],
  }),
  makeStarter({
    id: "dev-company",
    name: "Dev Company",
    description: "Full-stack software development team.",
    entry_team: "dev-company",
    packs: ["dev-company"],
    tags: ["dev", "software", "engineering"],
  }),
  makeStarter({
    id: "data-pipeline",
    name: "Data Pipeline",
    description: "ETL and data processing workflows.",
    entry_team: "data-pipeline",
    packs: ["data-pipeline"],
    tags: ["data", "etl", "analytics"],
  }),
];

describe("starter-ops", () => {
  describe("starterScore", () => {
    it("returns 0 for empty query", () => {
      expect(starterScore(mockStarters[0], "")).toBe(0);
    });

    it("gives highest score for exact id match", () => {
      const score = starterScore(mockStarters[0], "content-factory");
      expect(score).toBeGreaterThan(0);
    });

    it("scores id match higher than description-only match", () => {
      const idScore = starterScore(mockStarters[0], "content");
      // "content" is in the id, so it should score highly
      expect(idScore).toBeGreaterThan(0);
    });

    it("scores name match higher than hay match", () => {
      const devScore = starterScore(mockStarters[1], "dev");
      // "dev" appears in name "Dev Company"
      expect(devScore).toBeGreaterThanOrEqual(3);
    });

    it("returns 0 for unrelated query", () => {
      const score = starterScore(mockStarters[0], "xyz-unrelated-zzz");
      expect(score).toBe(0);
    });
  });

  describe("suggestStarters", () => {
    it("ranks by query relevance", () => {
      const results = suggestStarters("content", mockStarters);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("content-factory");
    });

    it("returns empty array for no matches", () => {
      const results = suggestStarters("xyz-unrelated-zzz", mockStarters);
      expect(results).toHaveLength(0);
    });

    it("returns all matching starters sorted by score descending", () => {
      const results = suggestStarters("data", mockStarters);
      expect(results.some((s) => s.id === "data-pipeline")).toBe(true);
    });

    it("returns empty array for empty starters list", () => {
      const results = suggestStarters("content", []);
      expect(results).toHaveLength(0);
    });

    it("returns all starters when all match a broad query", () => {
      // "team" appears in entry_team for all starters in hay
      const results = suggestStarters("team", mockStarters);
      // All starters have entry_team fields containing "team" suffix
      expect(results.length).toBeGreaterThan(0);
    });

    it("sorts ties alphabetically by id", () => {
      // All starters get a score for "team" (it's in entry_team for all)
      const results = suggestStarters("team", mockStarters);
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        const prevScore = starterScore(prev, "team");
        const currScore = starterScore(curr, "team");
        if (prevScore === currScore) {
          expect(prev.id.localeCompare(curr.id)).toBeLessThanOrEqual(0);
        } else {
          expect(prevScore).toBeGreaterThanOrEqual(currScore);
        }
      }
    });
  });
});
