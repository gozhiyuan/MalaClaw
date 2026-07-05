import path from "node:path";

/** True for relative paths that stay inside the workspace: no absolute paths,
 *  no drive letters, no `..` segments. `*` globs and `{{item}}` templates are
 *  allowed — they never introduce traversal. Pure string check so the Zod
 *  schema can use it at parse time. */
export function isSafeWorkspacePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  return !value.split(/[\\/]/).some((segment) => segment === "..");
}

/** Ids become unit keys and filenames (prompts, blockers, checkpoints). */
export const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Item ids come from worker-produced artifacts (outline.json) — untrusted. */
export const SAFE_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Join base + relative and assert the result stays under base. Defense in
 *  depth behind the schema checks: worker-influenced values (item ids,
 *  resolved templates) pass through here before touching the filesystem. */
export function resolveWithin(baseDir: string, relPath: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Path "${relPath}" escapes "${baseDir}"`);
  }
  return resolved;
}
