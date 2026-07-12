import type { StageRunOutcome } from "../../schema.js";
import type { WorkflowCommand } from "../../schema.js";

/** What a runtime can actually do. The engine validates stage requirements
 *  against these BEFORE execution, so a mismatched stage fails fast with a
 *  clear error instead of a mid-run worker failure. */
export type RuntimeCapabilities = {
  /** Writes exactly one model response into one concrete output file. */
  single_output: boolean;
  /** Can read the workspace and write multiple declared outputs. */
  multi_file_edit: boolean;
  /** Can invoke the stage-declared command as a tool during generation. */
  declared_command_tool: boolean;
  /** Provider-native tool/function calling beyond the declared command. */
  provider_tool_calling: boolean;
  /** Full CLI harness: shell tools, file tools, skills, MCP. */
  cli_harness_tools: boolean;
};

export type RuntimeHealth = {
  available: boolean;
  supports_headless: boolean;
  max_concurrent?: number;
  requires_isolated_workspace?: boolean;
  detail?: string;
};

export type StageRunRequest = {
  workspaceDir: string;
  unitKey: string;
  owner: string;
  /** Rendered stage-contract prompt (also persisted to prompts/ by the engine). */
  instructions: string;
  /** Declared output paths; concrete paths are the contract the worker must satisfy. */
  outputs: string[];
  command?: WorkflowCommand;
  /** Stage-granted harness tools (claude-code --allowedTools). Additive to
   *  the runtime's safe defaults; ignored by non-harness runtimes. */
  allowedTools?: string[];
  timeoutMs: number;
  model?: string;
  promptPath?: string;
  logPath?: string;
};

export type StageRunResult = {
  outcome: StageRunOutcome;
  /** Concrete files the runtime claims to have produced. */
  producedFiles: string[];
  message?: string;
  logRef?: string;
  /** Provider-reported wait before a quota retry, when a concrete reset time
   * can be parsed from the CLI failure output. */
  retryAfterMs?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    /** Some CLIs (codex) only report a combined total. */
    total_tokens?: number;
    cost_usd?: number;
  };
};

/** The execution boundary. The engine owns scheduling, retries, validation,
 *  and state; a runtime only knows how to run one unit of work headlessly. */
export interface WorkerRuntime {
  readonly id: string;
  readonly capabilities: RuntimeCapabilities;
  checkAvailable(): Promise<RuntimeHealth>;
  runStage(req: StageRunRequest): Promise<StageRunResult>;
}

export const SINGLE_OUTPUT_API_CAPABILITIES: RuntimeCapabilities = {
  single_output: true,
  multi_file_edit: false,
  declared_command_tool: false,
  provider_tool_calling: false,
  cli_harness_tools: false,
};

export const CLI_HARNESS_CAPABILITIES: RuntimeCapabilities = {
  single_output: true,
  multi_file_edit: true,
  declared_command_tool: true, // the harness can run the declared command itself
  provider_tool_calling: true,
  cli_harness_tools: true,
};

export const DETERMINISTIC_CAPABILITIES: RuntimeCapabilities = {
  single_output: true,
  multi_file_edit: true,
  declared_command_tool: true,
  provider_tool_calling: false,
  cli_harness_tools: false,
};
