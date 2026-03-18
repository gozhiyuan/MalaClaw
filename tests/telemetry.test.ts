import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";

import {
  resolveAgentTelemetryDir,
  resolveAgentTelemetryFile,
  resolveClawTeamDataDir,
} from "../src/lib/paths.js";

const originalMalaclaw = process.env.MALACLAW_DIR;
const originalClawteam = process.env.CLAWTEAM_DATA_DIR;

afterEach(() => {
  if (originalMalaclaw === undefined) delete process.env.MALACLAW_DIR;
  else process.env.MALACLAW_DIR = originalMalaclaw;
  if (originalClawteam === undefined) delete process.env.CLAWTEAM_DATA_DIR;
  else process.env.CLAWTEAM_DATA_DIR = originalClawteam;
});

describe("telemetry path resolution", () => {
  it("resolveAgentTelemetryDir returns agents dir under store root", () => {
    process.env.MALACLAW_DIR = "/tmp/test-malaclaw";
    expect(resolveAgentTelemetryDir()).toBe("/tmp/test-malaclaw/agents");
  });

  it("resolveAgentTelemetryFile returns state.json for given agent ID", () => {
    process.env.MALACLAW_DIR = "/tmp/test-malaclaw";
    expect(resolveAgentTelemetryFile("store__proj__team__pm")).toBe(
      "/tmp/test-malaclaw/agents/store__proj__team__pm/state.json"
    );
  });
});

describe("ClawTeam path resolution", () => {
  it("resolveClawTeamDataDir uses env var when set", () => {
    process.env.CLAWTEAM_DATA_DIR = "/tmp/test-clawteam";
    expect(resolveClawTeamDataDir()).toBe("/tmp/test-clawteam");
  });

  it("resolveClawTeamDataDir falls back to ~/.clawteam", () => {
    delete process.env.CLAWTEAM_DATA_DIR;
    const result = resolveClawTeamDataDir();
    expect(result).toContain(".clawteam");
  });
});
