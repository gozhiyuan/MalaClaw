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
