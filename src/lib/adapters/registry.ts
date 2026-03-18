import type { RuntimeTarget } from "../schema.js";
import type { RuntimeProvisioner, RuntimeObserver } from "./base.js";
import { OpenClawProvisioner, OpenClawObserver } from "./openclaw.js";
import { ClaudeCodeProvisioner } from "./claude-code.js";
import { CodexProvisioner } from "./codex.js";
import { ClawTeamProvisioner, ClawTeamObserver } from "./clawteam.js";

export function getProvisioner(runtime: RuntimeTarget): RuntimeProvisioner {
  switch (runtime) {
    case "openclaw":
      return new OpenClawProvisioner();
    case "claude-code":
      return new ClaudeCodeProvisioner();
    case "codex":
      return new CodexProvisioner();
    case "clawteam":
      return new ClawTeamProvisioner();
    default:
      throw new Error(`Unknown runtime: ${runtime}`);
  }
}

export function getObserver(runtime: RuntimeTarget): RuntimeObserver {
  switch (runtime) {
    case "openclaw":
      return new OpenClawObserver();
    case "clawteam":
      return new ClawTeamObserver("clawteam");
    case "claude-code":
      return new ClawTeamObserver("claude-code");
    case "codex":
      return new ClawTeamObserver("codex");
    default:
      throw new Error(`Unknown runtime: ${runtime}`);
  }
}
