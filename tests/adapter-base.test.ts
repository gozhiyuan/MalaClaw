import { describe, it, expect } from "vitest";
import type { RuntimeProvisioner, RuntimeObserver } from "../src/lib/adapters/base.js";
import { OpenClawProvisioner, OpenClawObserver } from "../src/lib/adapters/openclaw.js";
import { ClaudeCodeProvisioner } from "../src/lib/adapters/claude-code.js";

describe("RuntimeProvisioner interface", () => {
  it("can be implemented with required methods", () => {
    const provisioner: RuntimeProvisioner = {
      runtime: "openclaw",
      async installTeam() { return; },
      async uninstallTeam() { return; },
      async planInstallTeam() { return []; },
    };
    expect(provisioner.runtime).toBe("openclaw");
  });
});

describe("RuntimeObserver interface", () => {
  it("can be implemented with required methods", () => {
    const observer: RuntimeObserver = {
      runtime: "openclaw",
      async start() { return; },
      async stop() { return; },
      async getAgentStatuses() { return []; },
    };
    expect(observer.runtime).toBe("openclaw");
  });
});

describe("OpenClawProvisioner", () => {
  it("implements RuntimeProvisioner with runtime='openclaw'", () => {
    const p = new OpenClawProvisioner();
    expect(p.runtime).toBe("openclaw");
    expect(typeof p.installTeam).toBe("function");
    expect(typeof p.uninstallTeam).toBe("function");
    expect(typeof p.planInstallTeam).toBe("function");
  });
});

describe("OpenClawObserver", () => {
  it("implements RuntimeObserver with runtime='openclaw'", () => {
    const o = new OpenClawObserver();
    expect(o.runtime).toBe("openclaw");
    expect(typeof o.start).toBe("function");
    expect(typeof o.stop).toBe("function");
    expect(typeof o.getAgentStatuses).toBe("function");
  });
});

describe("ClaudeCodeProvisioner", () => {
  it("implements RuntimeProvisioner with runtime='claude-code'", () => {
    const p = new ClaudeCodeProvisioner();
    expect(p.runtime).toBe("claude-code");
    expect(typeof p.installTeam).toBe("function");
    expect(typeof p.uninstallTeam).toBe("function");
    expect(typeof p.planInstallTeam).toBe("function");
  });
});
