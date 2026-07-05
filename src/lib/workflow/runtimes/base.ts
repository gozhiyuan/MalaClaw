import type { StageRunOutcome } from "../../schema.js";

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
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
};

/** The execution boundary. The engine owns scheduling, retries, validation,
 *  and state; a runtime only knows how to run one unit of work headlessly. */
export interface WorkerRuntime {
  readonly id: string;
  checkAvailable(): Promise<RuntimeHealth>;
  runStage(req: StageRunRequest): Promise<StageRunResult>;
}
