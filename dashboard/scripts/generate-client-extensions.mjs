import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, "..");
const generatedPath = path.join(dashboardRoot, "src/extensions/generated.tsx");
const longWriteClientEntry = path.resolve(
  dashboardRoot,
  "../../MrMaLiang/packages/longwrite/dashboard-extension/client/index.tsx",
);
const includeLocalLongWrite = process.env.MALACLAW_DASHBOARD_SKIP_LOCAL_LONGWRITE !== "1";

const typeImport = 'import type { DashboardClientExtension } from "./types";\n';

let source;
if (includeLocalLongWrite && existsSync(longWriteClientEntry)) {
  source = `${typeImport}import { longWriteDashboardClientExtension } from "../../../../MrMaLiang/packages/longwrite/dashboard-extension/client";\n\nexport const dashboardClientExtensions: DashboardClientExtension[] = [\n  longWriteDashboardClientExtension,\n];\n`;
} else {
  source = `${typeImport}\nexport const dashboardClientExtensions: DashboardClientExtension[] = [];\n`;
}

mkdirSync(path.dirname(generatedPath), { recursive: true });
writeFileSync(generatedPath, source);
