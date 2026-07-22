import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runValidators } from "../src/lib/workflow/validators.js";

const tempDirs: string[] = [];
async function makeWorkspace(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "malaclaw-val-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf-8");
  }
  return dir;
}
afterEach(async () => {
  while (tempDirs.length > 0) await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe("runValidators", () => {
  it("passes when required outputs exist", async () => {
    const ws = await makeWorkspace({ "plan.md": "# plan" });
    const report = await runValidators(["required_output_exists"], ["plan.md"], ws);
    expect(report.pass).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("fails with a named finding when an output is missing", async () => {
    const ws = await makeWorkspace();
    const report = await runValidators(["required_output_exists"], ["plan.md"], ws);
    expect(report.pass).toBe(false);
    expect(report.findings[0]).toContain("plan.md");
  });

  it("ignores glob/template outputs in existence checks (M2a)", async () => {
    const ws = await makeWorkspace();
    const report = await runValidators(["required_output_exists"], ["chapters/*.md"], ws);
    expect(report.pass).toBe(true);
  });

  it("fails empty markdown outputs", async () => {
    const ws = await makeWorkspace({ "plan.md": "   \n " });
    const report = await runValidators(["non_empty_markdown"], ["plan.md"], ws);
    expect(report.pass).toBe(false);
  });

  it("checks jsonl outputs line by line", async () => {
    const ws = await makeWorkspace({
      "good.jsonl": '{"a":1}\n{"b":2}\n',
      "bad.jsonl": '{"a":1}\nnot json\n',
    });
    const good = await runValidators(["jsonl_parseable"], ["good.jsonl"], ws);
    expect(good.pass).toBe(true);
    const bad = await runValidators(["jsonl_parseable"], ["bad.jsonl"], ws);
    expect(bad.pass).toBe(false);
    expect(bad.findings[0]).toContain("bad.jsonl");
  });

  it("fails closed on unknown validator names", async () => {
    const ws = await makeWorkspace({ "plan.md": "# plan" });
    const report = await runValidators(["definitely_not_real"], ["plan.md"], ws);
    expect(report.pass).toBe(false);
    expect(report.findings[0]).toContain("definitely_not_real");
  });

  it("runs external validator commands", async () => {
    const ws = await makeWorkspace({ "plan.md": "# plan" });
    const pass = await runValidators([], ["plan.md"], ws, [
      { cmd: process.execPath, args: ["-e", "process.exit(0)"] },
    ]);
    expect(pass.pass).toBe(true);

    const fail = await runValidators([], ["plan.md"], ws, [
      { cmd: process.execPath, args: ["-e", "console.error('bad citations'); process.exit(2)"] },
    ]);
    expect(fail.pass).toBe(false);
    expect(fail.findings[0]).toContain("bad citations");
  });

  it("allows a validator command to materialize a declared derived artifact", async () => {
    const ws = await makeWorkspace({ "raw.json": "{}" });
    const report = await runValidators(["required_output_exists"], ["raw.json", "normalized.json"], ws, [
      { cmd: process.execPath, args: ["-e", "require('fs').writeFileSync('normalized.json', '{}')"] },
    ]);
    expect(report.pass).toBe(true);
  });
});
