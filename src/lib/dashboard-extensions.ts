import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

/** Dashboard server-extension resolution shared by the dashboard host and the
 *  `malaclaw dashboard extensions` CLI. Sources, in order:
 *    1. MALACLAW_DASHBOARD_SERVER_EXTENSIONS (comma-separated, env)
 *    2. <MALACLAW_DIR>/dashboard.yaml — `dashboard.server_extensions:` list
 *  Extensions are trusted local code: they run inside the dashboard process
 *  with filesystem access. Only load extensions you would run as a script. */

export type ExtensionSpec = {
  spec: string;
  source: "env" | "config";
};

export function dashboardConfigPath(): string {
  const root = process.env.MALACLAW_DIR ?? path.join(os.homedir(), ".malaclaw");
  return path.join(root, "dashboard.yaml");
}

async function configSpecs(): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(dashboardConfigPath(), "utf-8");
  } catch {
    return [];
  }
  try {
    const parsed = parseYaml(raw) as { dashboard?: { server_extensions?: unknown } } | null;
    const entries = parsed?.dashboard?.server_extensions;
    if (!Array.isArray(entries)) return [];
    return entries.filter((e): e is string => typeof e === "string" && e.trim().length > 0).map((e) => e.trim());
  } catch {
    // Malformed config surfaces through doctor; the host just skips it.
    return [];
  }
}

export async function resolveDashboardExtensionSpecs(): Promise<ExtensionSpec[]> {
  const seen = new Set<string>();
  const resolved: ExtensionSpec[] = [];
  const push = (spec: string, source: ExtensionSpec["source"]) => {
    if (seen.has(spec)) return;
    seen.add(spec);
    resolved.push({ spec, source });
  };
  for (const spec of (process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS ?? "").split(",")) {
    if (spec.trim()) push(spec.trim(), "env");
  }
  for (const spec of await configSpecs()) push(spec, "config");
  return resolved;
}

export async function toImportSpecifier(spec: string): Promise<string> {
  if (spec.startsWith("file://")) return spec;
  if (spec.startsWith(".") || spec.startsWith("/") || spec.includes(path.sep)) {
    return pathToFileURL(await fs.realpath(path.resolve(spec))).href;
  }
  return spec; // bare package specifier
}

export type ExtensionDiagnosis = {
  spec: string;
  source: ExtensionSpec["source"];
  ok: boolean;
  id?: string;
  problems: string[];
};

/** No-op host: doctor instantiates factories without a live dashboard. */
const STUB_HOST = {
  loadFlowState: async () => null,
  logsDir: () => "",
  approveAllFlow: async () => null,
  approveFlow: async () => null,
  summarizeUsage: async () => null,
};

export async function diagnoseDashboardExtension(entry: ExtensionSpec): Promise<ExtensionDiagnosis> {
  const problems: string[] = [];
  const isPathSpec = entry.spec.startsWith(".") || entry.spec.startsWith("/") || entry.spec.includes(path.sep);
  if (isPathSpec) {
    try {
      await fs.access(path.resolve(entry.spec));
    } catch {
      return { ...entry, ok: false, problems: [`file not found: ${path.resolve(entry.spec)} (build the extension first?)`] };
    }
  }

  let mod: Record<string, unknown>;
  try {
    mod = await import(await toImportSpecifier(entry.spec)) as Record<string, unknown>;
  } catch (err) {
    return { ...entry, ok: false, problems: [`import failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const exported = mod.createDashboardServerExtension ?? mod.default;
  if (exported === undefined) {
    return { ...entry, ok: false, problems: ["module exports neither createDashboardServerExtension(host) nor default"] };
  }

  let extension: unknown = exported;
  if (typeof exported === "function") {
    try {
      extension = await (exported as (host: unknown) => unknown)(STUB_HOST);
    } catch (err) {
      return { ...entry, ok: false, problems: [`factory threw: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }

  const id = (extension as { id?: unknown })?.id;
  if (typeof id !== "string" || id.length === 0) problems.push("extension has no string id");
  if (typeof (extension as { routes?: unknown })?.routes !== "function") problems.push("extension has no routes(app) function");

  return {
    ...entry,
    ok: problems.length === 0,
    id: typeof id === "string" ? id : undefined,
    problems,
  };
}
