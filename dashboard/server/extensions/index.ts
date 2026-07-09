import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import type {
  DashboardServerExtension,
  DashboardServerExtensionFactory,
  DashboardServerExtensionHost,
} from "./types.js";

type ExtensionModule = {
  createDashboardServerExtension?: DashboardServerExtensionFactory;
  default?: DashboardServerExtensionFactory | DashboardServerExtension;
};

function extensionSpecs(): string[] {
  return (process.env.MALACLAW_DASHBOARD_SERVER_EXTENSIONS ?? "")
    .split(",")
    .map((spec) => spec.trim())
    .filter(Boolean);
}

async function importSpecifier(spec: string): Promise<string> {
  if (spec.startsWith("file://")) return spec;
  if (spec.startsWith(".") || spec.startsWith("/") || spec.includes(path.sep)) {
    return pathToFileURL(await fs.realpath(path.resolve(spec))).href;
  }
  return spec;
}

function isExtension(value: unknown): value is DashboardServerExtension {
  return typeof value === "object" && value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { routes?: unknown }).routes === "function";
}

async function instantiateExtension(
  spec: string,
  host: DashboardServerExtensionHost,
): Promise<DashboardServerExtension> {
  const mod = await import(/* @vite-ignore */ await importSpecifier(spec)) as ExtensionModule;
  const exported = mod.createDashboardServerExtension ?? mod.default;
  if (typeof exported === "function") {
    const extension = await exported(host);
    if (!isExtension(extension)) throw new Error(`Dashboard extension "${spec}" returned an invalid extension`);
    return extension;
  }
  if (isExtension(exported)) return exported;
  throw new Error(`Dashboard extension "${spec}" must export createDashboardServerExtension(host) or default`);
}

/** Load product-specific server extensions from installed packages or local
 *  filesystem modules. This keeps the core dashboard independent of downstream
 *  apps such as LongWrite. */
export async function loadDashboardServerExtensions(
  host: DashboardServerExtensionHost,
): Promise<DashboardServerExtension[]> {
  const loaded: DashboardServerExtension[] = [];
  for (const spec of extensionSpecs()) {
    try {
      loaded.push(await instantiateExtension(spec, host));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to load dashboard extension ${spec}: ${message}`);
    }
  }
  return loaded;
}
