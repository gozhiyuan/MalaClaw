import { describe, it, expect } from "vitest";
import { MemoryWriter } from "../services/memory-writer.js";

describe("MemoryWriter", () => {
  it("is constructable", () => {
    const writer = new MemoryWriter();
    expect(writer).toBeDefined();
  });

  it("has writeKanban method", () => {
    const writer = new MemoryWriter();
    expect(typeof writer.writeKanban).toBe("function");
  });

  it("has writeBlockers method", () => {
    const writer = new MemoryWriter();
    expect(typeof writer.writeBlockers).toBe("function");
  });
});
