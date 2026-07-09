import {
  resolveDashboardExtensionSpecs,
  toImportSpecifier,
} from "../../../dist/lib/dashboard-extensions.js";
import type {
  DashboardServerExtension,
  DashboardServerExtensionFactory,
  DashboardServerExtensionHost,
} from "./types.js";

type ExtensionModule = {
  createDashboardServerExtension?: DashboardServerExtensionFactory;
  default?: DashboardServerExtensionFactory | DashboardServerExtension;
};

function isExtension(value: unknown): value is DashboardServerExtension {
  return typeof value === "object" && value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { routes?: unknown }).routes === "function";
}

async function instantiateExtension(
  spec: string,
  host: DashboardServerExtensionHost,
): Promise<DashboardServerExtension> {
  const mod = await import(/* @vite-ignore */ await toImportSpecifier(spec)) as ExtensionModule;
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
 *  filesystem modules (env var + ~/.malaclaw/dashboard.yaml). Extensions are
 *  trusted local code running inside the dashboard process. This keeps the
 *  core dashboard independent of downstream apps such as LongWrite. */
export async function loadDashboardServerExtensions(
  host: DashboardServerExtensionHost,
): Promise<DashboardServerExtension[]> {
  const loaded: DashboardServerExtension[] = [];
  for (const { spec } of await resolveDashboardExtensionSpecs()) {
    try {
      loaded.push(await instantiateExtension(spec, host));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to load dashboard extension ${spec}: ${message}`);
    }
  }
  return loaded;
}
