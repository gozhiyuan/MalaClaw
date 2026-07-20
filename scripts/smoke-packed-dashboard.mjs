import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblingLongWrite = path.resolve(repoRoot, "..", "MrMaLiang", "packages", "longwrite");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} ${args.join(" ")} timed out\n${stderr || stdout}`));
    }, opts.timeoutMs ?? 120_000);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} failed with exit code ${code}\n${stderr || stdout}`));
    });
  });
}

async function pack(packageDir, tmpDir, label) {
  const { stdout } = await run("npm", ["pack", packageDir, "--pack-destination", tmpDir], {
    timeoutMs: 180_000,
  });
  if (!stdout.trim()) throw new Error(`npm pack produced no output for ${label}`);
  return path.join(tmpDir, stdout.trim().split("\n").at(-1));
}

async function launchDashboard(cwd, malaclawBin, env) {
  const child = spawn(malaclawBin, ["dashboard", "--port", "0"], {
    cwd,
    env: { ...process.env, NODE_ENV: "production", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  if (child.exitCode !== null) {
    throw new Error(`packed dashboard exited early\n${stderr || stdout}`);
  }
  if (!stdout.includes("Dashboard running at")) {
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
    throw new Error(`packed dashboard did not report startup\n${stderr || stdout}`);
  }
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-pack-smoke-"));
try {
  const malaclawTarball = await pack(repoRoot, tmpDir, "MalaClaw");
  await run("npm", ["init", "-y"], { cwd: tmpDir });
  const installTargets = [malaclawTarball];

  const longwritePackage = path.join(siblingLongWrite, "package.json");
  const hasSiblingLongWrite = await exists(longwritePackage);
  if (hasSiblingLongWrite) installTargets.push(await pack(siblingLongWrite, tmpDir, "LongWrite"));

  await run("npm", ["install", ...installTargets], { cwd: tmpDir, timeoutMs: 240_000 });
  const malaclawBin = path.join(tmpDir, "node_modules", ".bin", "malaclaw");

  const malaclawHome = path.join(tmpDir, "malaclaw-home");
  await fs.mkdir(malaclawHome, { recursive: true });
  if (hasSiblingLongWrite) {
    const extensionPath = path.join(tmpDir, "node_modules", "longwrite", "dashboard-extension", "dist", "server", "index.js");
    await fs.writeFile(
      path.join(malaclawHome, "dashboard.yaml"),
      `dashboard:\n  server_extensions:\n    - ${extensionPath}\n`,
      "utf-8",
    );
    await run(malaclawBin, ["dashboard-extensions", "doctor"], {
      cwd: tmpDir,
      env: { MALACLAW_DIR: malaclawHome },
    });
  }

  await launchDashboard(tmpDir, malaclawBin, { MALACLAW_DIR: malaclawHome });
  console.log(`✓ packed dashboard smoke passed${hasSiblingLongWrite ? " with LongWrite extension" : ""}`);
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}
