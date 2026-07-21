import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteJobRuntime } from "../src/lib/workflow/runtimes/remote-job.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("RemoteJobRuntime", () => {
  it("persists an adapter handle while a remote job is pending", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-remote-"));
    roots.push(workspaceDir);
    const runtime = new RemoteJobRuntime();
    const result = await runtime.runStage({
      workspaceDir, unitKey: "gpu", owner: "runner", instructions: "", outputs: ["results.json"], timeoutMs: 5_000,
      command: { cmd: process.execPath, args: ["-e", "console.log(JSON.stringify({version:1,status:'running',job_id:'job-1',adapter:'fake',retry_after_seconds:1}))"] },
    });
    expect(result.outcome).toBe("remote_pending");
    expect(result.remoteJob).toMatchObject({ adapter: "fake", jobId: "job-1", status: "running" });
    expect(result.retryAfterMs).toBe(1_000);
  });

  it("collects outputs after completion and sends a provider-side cancel operation", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-remote-lifecycle-"));
    roots.push(workspaceDir);
    const adapter = path.join(workspaceDir, "adapter.mjs");
    await fs.writeFile(adapter, [
      "import fs from 'node:fs';",
      "let body=''; process.stdin.on('data', c => body += c); process.stdin.on('end', () => {",
      "const req=JSON.parse(body); if (req.operation === 'collect') fs.writeFileSync('results.json','ok');",
      "const status = req.operation === 'cancel' ? 'cancelled' : req.operation === 'submit' ? 'running' : 'succeeded';",
      "console.log(JSON.stringify({version:1,status,job_id:'job-2',adapter:'fixture'})); });",
    ].join("\n"));
    const runtime = new RemoteJobRuntime();
    const command = { cmd: process.execPath, args: [adapter] };
    const pending = await runtime.runStage({ workspaceDir, unitKey: "gpu", owner: "runner", instructions: "", outputs: ["results.json"], timeoutMs: 5_000, command });
    expect(pending.outcome).toBe("remote_pending");
    const completed = await runtime.runStage({ workspaceDir, unitKey: "gpu", owner: "runner", instructions: "", outputs: ["results.json"], timeoutMs: 5_000, command, remoteJob: pending.remoteJob });
    expect(completed.outcome).toBe("success");
    await expect(fs.readFile(path.join(workspaceDir, "results.json"), "utf8")).resolves.toBe("ok");
    const cancelled = await runtime.runStage({ workspaceDir, unitKey: "gpu", owner: "runner", instructions: "", outputs: [], timeoutMs: 5_000, command, remoteJob: pending.remoteJob, remoteOperation: "cancel" });
    expect(cancelled.outcome).toBe("cancelled");
  });
});
