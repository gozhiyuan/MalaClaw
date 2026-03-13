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
