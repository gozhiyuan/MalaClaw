import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export type SubprocessOptions = {
  bin: string;
  args: string[];
  cwd: string;
  /** Written to the child's stdin, then stdin is closed. */
  stdinText?: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  /** Combined stdout+stderr is always written here. */
  logPath: string;
};

export type SubprocessResult = {
  code: number | null;
  /** Combined stdout+stderr. */
  output: string;
  timedOut: boolean;
  spawnError?: string;
};

/** Spawn a headless worker process: no shell interpolation, combined output
 *  captured to the log file, SIGTERM on timeout. Shared by all CLI-backed
 *  worker runtimes. */
export async function runSubprocess(opts: SubprocessOptions): Promise<SubprocessResult> {
  await fs.mkdir(path.dirname(opts.logPath), { recursive: true });

  return new Promise((resolve) => {
    const child = spawn(opts.bin, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: [opts.stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let settled = false;
    const finish = async (result: SubprocessResult) => {
      if (settled) return;
      settled = true;
      await fs.writeFile(opts.logPath, result.output, "utf-8").catch(() => {});
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      void finish({
        code: null,
        output: Buffer.concat(chunks).toString("utf-8"),
        timedOut: true,
      });
    }, opts.timeoutMs);

    if (opts.stdinText !== undefined && child.stdin) {
      child.stdin.write(opts.stdinText);
      child.stdin.end();
    }
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      void finish({ code: null, output: "", timedOut: false, spawnError: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      void finish({
        code,
        output: Buffer.concat(chunks).toString("utf-8"),
        timedOut: false,
      });
    });
  });
}
