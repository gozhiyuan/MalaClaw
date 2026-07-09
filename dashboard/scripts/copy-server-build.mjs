import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "dist", "server");
const to = path.join(root, "server");

function shouldCopy(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized.includes("/__tests__/") || normalized.startsWith("__tests__/")) return false;
  if (normalized.endsWith(".test.js") || normalized.endsWith(".test.d.ts")) return false;
  if (normalized.startsWith("routes/longwrite.")) return false;
  if (normalized.startsWith("extensions/longwrite/")) return false;
  return normalized.endsWith(".js") || normalized.endsWith(".d.ts");
}

async function removeGeneratedServerFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeGeneratedServerFiles(target);
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
      await fs.rm(target, { force: true });
    }
  }
}

async function copyGeneratedServerFiles(srcDir, dstDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await fs.mkdir(dstDir, { recursive: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await copyGeneratedServerFiles(src, dst);
    } else if (entry.isFile() && shouldCopy(path.relative(from, src))) {
      await fs.copyFile(src, dst);
    }
  }
}

await removeGeneratedServerFiles(to);
await copyGeneratedServerFiles(from, to);
