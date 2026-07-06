import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolveWithin } from "./safe-paths.js";
import type { WorkflowCommand } from "../schema.js";

export type ValidatorReport = {
  pass: boolean;
  findings: string[];
};

type ValidatorFn = (outputs: string[], workspaceDir: string) => Promise<string[]>;

function concreteOutputs(outputs: string[]): string[] {
  return outputs.filter((o) => !o.includes("*") && !o.includes("{{"));
}

// Unsafe paths resolve to "" and read as missing — fail closed.
function safeJoin(workspaceDir: string, output: string): string {
  try {
    return resolveWithin(workspaceDir, output);
  } catch {
    return "";
  }
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

const builtins: Record<string, ValidatorFn> = {
  async required_output_exists(outputs, workspaceDir) {
    const findings: string[] = [];
    for (const output of concreteOutputs(outputs)) {
      if ((await readIfExists(safeJoin(workspaceDir, output))) === null) {
        findings.push(`required_output_exists: "${output}" was not produced`);
      }
    }
    return findings;
  },

  async non_empty_markdown(outputs, workspaceDir) {
    const findings: string[] = [];
    for (const output of concreteOutputs(outputs).filter((o) => o.endsWith(".md"))) {
      const content = await readIfExists(safeJoin(workspaceDir, output));
      if (content === null || content.trim().length === 0) {
        findings.push(`non_empty_markdown: "${output}" is missing or empty`);
      }
    }
    return findings;
  },

  async jsonl_parseable(outputs, workspaceDir) {
    const findings: string[] = [];
    for (const output of concreteOutputs(outputs).filter((o) => o.endsWith(".jsonl"))) {
      const content = await readIfExists(safeJoin(workspaceDir, output));
      if (content === null) {
        findings.push(`jsonl_parseable: "${output}" was not produced`);
        continue;
      }
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      for (let i = 0; i < lines.length; i++) {
        try {
          JSON.parse(lines[i]);
        } catch {
          findings.push(`jsonl_parseable: "${output}" line ${i + 1} is not valid JSON`);
          break;
        }
      }
    }
    return findings;
  },
};

function outputLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function commandLabel(command: WorkflowCommand): string {
  return [command.cmd, ...command.args].join(" ");
}

async function runValidatorCommand(
  command: WorkflowCommand,
  outputs: string[],
  workspaceDir: string,
): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(command.cmd, command.args, {
      cwd: workspaceDir,
      env: {
        ...process.env,
        MALACLAW_WORKSPACE: workspaceDir,
        MALACLAW_VALIDATOR_OUTPUTS: JSON.stringify(outputs),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve([`external validator timed out: ${commandLabel(command)}`]);
    }, 120_000);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve([`external validator failed to start: ${commandLabel(command)}: ${err.message}`]);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf-8");
      const err = Buffer.concat(stderr).toString("utf-8");
      if (code === 0) return resolve([]);
      const lines = [...outputLines(err), ...outputLines(out)];
      resolve(lines.length > 0
        ? lines.map((line) => `external validator ${commandLabel(command)}: ${line}`)
        : [`external validator ${commandLabel(command)} exited with code ${code}`]);
    });
  });
}

/** Run named validators over a unit's declared outputs. Unknown validator
 *  names fail closed — a typo must not silently skip a quality gate. */
export async function runValidators(
  names: string[],
  outputs: string[],
  workspaceDir: string,
  commands: WorkflowCommand[] = [],
): Promise<ValidatorReport> {
  const findings: string[] = [];
  for (const name of names) {
    const fn = builtins[name];
    if (!fn) {
      findings.push(`unknown validator "${name}" (fail closed)`);
      continue;
    }
    findings.push(...(await fn(outputs, workspaceDir)));
  }
  for (const command of commands) {
    findings.push(...(await runValidatorCommand(command, outputs, workspaceDir)));
  }
  return { pass: findings.length === 0, findings };
}
