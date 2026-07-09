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
