import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateProjectManifest } from "../src/lib/manifest-validate.js";

const tempDirs: string[] = [];

async function makeProject(yaml: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-test-"));
  tempDirs.push(dir);
  await fs.writeFile(path.join(dir, "malaclaw.yaml"), yaml, "utf-8");
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("validateProjectManifest", () => {
  it("reports found=false when no malaclaw.yaml exists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-test-"));
    tempDirs.push(dir);
    const result = await validateProjectManifest(dir);
    expect(result.found).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid workflow-enabled manifest", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
      owner: pm
      outputs:
        - plan.md
    - id: build
      owner: tech-lead
      inputs:
        - plan.md
`);
    const result = await validateProjectManifest(dir);
    expect(result.found).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a manifest with a foreach stage", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: outline
      owner: pm
      outputs:
        - outline.json
    - id: draft_items
      type: foreach
      foreach: outline.sections
      max_parallel: 4
      steps:
        - id: draft
          owner: tech-lead
          inputs:
            - outline.json
          outputs:
            - chapters/{{item.id}}.md
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("rejects a manifest with an unknown stage owner", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
      owner: ghost-writer
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("ghost-writer");
  });

  it("rejects a manifest with duplicate stage ids", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
      owner: pm
    - id: plan
      owner: pm
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n").toLowerCase()).toContain("duplicate stage id");
  });

  it("rejects a manifest whose stage is missing required fields", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: plan
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("surfaces provenance warnings for a valid manifest", async () => {
    const dir = await makeProject(`
version: 1
packs:
  - id: dev-company
workflow:
  stages:
    - id: build
      owner: tech-lead
      inputs:
        - plan.md
`);
    const result = await validateProjectManifest(dir);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});
