import path from "node:path";
import { fileURLToPath } from "node:url";

export async function runDashboard(opts: { port?: number; host?: string; authToken?: string }): Promise<void> {
  const port = opts.port ?? 3456;
  const host = opts.host ?? "127.0.0.1";

  // Resolve the dashboard server entry at runtime — it lives outside src/
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const serverPath = path.resolve(__dirname, "../../dashboard/server/index.js");
  const mod = await import(serverPath) as { createServer: (opts: { port: number; host: string; authToken?: string }) => Promise<unknown> };
  await mod.createServer({ port, host, authToken: opts.authToken });
}

export async function runDashboardExtensionsList(): Promise<void> {
  const { resolveDashboardExtensionSpecs, dashboardConfigPath } = await import("../lib/dashboard-extensions.js");
  const specs = await resolveDashboardExtensionSpecs();
  console.log(`# Dashboard server extensions\n`);
  console.log(`Config file: ${dashboardConfigPath()}`);
  console.log(`Env var:     MALACLAW_DASHBOARD_SERVER_EXTENSIONS\n`);
  if (specs.length === 0) {
    console.log("No extensions configured.");
    console.log("Add one to the config file:\n");
    console.log("  dashboard:\n    server_extensions:\n      - /path/to/extension/dist/server/index.js");
    return;
  }
  for (const entry of specs) {
    console.log(`- [${entry.source}] ${entry.spec}`);
  }
  console.log("\nNote: extensions are trusted local code running inside the dashboard process.");
}

export async function runDashboardExtensionsDoctor(): Promise<void> {
  const { resolveDashboardExtensionSpecs, diagnoseDashboardExtension } = await import("../lib/dashboard-extensions.js");
  const specs = await resolveDashboardExtensionSpecs();
  if (specs.length === 0) {
    console.log("No extensions configured. Run: malaclaw dashboard-extensions list");
    return;
  }
  let failures = 0;
  for (const entry of specs) {
    const diagnosis = await diagnoseDashboardExtension(entry);
    if (diagnosis.ok) {
      console.log(`✓ ${entry.spec} (id: ${diagnosis.id})`);
    } else {
      failures += 1;
      console.log(`✗ ${entry.spec}`);
      for (const problem of diagnosis.problems) console.log(`    ${problem}`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}
