import fs from "node:fs/promises";
import { resolveWithin } from "./safe-paths.js";

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

/** Run named validators over a unit's declared outputs. Unknown validator
 *  names fail closed — a typo must not silently skip a quality gate. */
export async function runValidators(
  names: string[],
  outputs: string[],
  workspaceDir: string,
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
  return { pass: findings.length === 0, findings };
}
