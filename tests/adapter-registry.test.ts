import { describe, it, expect } from "vitest";
import { getProvisioner, getObserver } from "../src/lib/adapters/registry.js";

describe("getProvisioner", () => {
  it("returns OpenClaw provisioner for 'openclaw'", () => {
    expect(getProvisioner("openclaw").runtime).toBe("openclaw");
  });

  it("returns Claude Code provisioner for 'claude-code'", () => {
    expect(getProvisioner("claude-code").runtime).toBe("claude-code");
  });

  it("returns Codex provisioner for 'codex'", () => {
    expect(getProvisioner("codex").runtime).toBe("codex");
  });

  it("returns ClawTeam provisioner for 'clawteam'", () => {
    expect(getProvisioner("clawteam").runtime).toBe("clawteam");
  });
});

describe("getObserver", () => {
  it("returns OpenClaw observer for 'openclaw'", () => {
    expect(getObserver("openclaw").runtime).toBe("openclaw");
  });

  it("returns ClawTeam observer for 'clawteam'", () => {
    expect(getObserver("clawteam").runtime).toBe("clawteam");
  });

  it("returns ClawTeam observer for 'claude-code' (ClawTeam tracks these)", () => {
    expect(getObserver("claude-code").runtime).toBe("claude-code");
  });

  it("returns ClawTeam observer for 'codex' (ClawTeam tracks these)", () => {
    expect(getObserver("codex").runtime).toBe("codex");
  });
});
