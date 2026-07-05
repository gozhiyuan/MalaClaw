import fs from "node:fs/promises";
import path from "node:path";
import type { ForeachStage } from "../schema.js";

/** Replace item-id templates with the concrete item id before a runtime sees paths. */
export function resolveItemTemplates(text: string, itemName: string, itemId: string): string {
  return text
    .replaceAll(`{{${itemName}.id}}`, itemId)
    .replaceAll("{{item.id}}", itemId);
}

/** `foreach: "<base>.<key>"` reads `<base>.json` and returns string ids under `<key>`. */
export async function expandForeachItems(stage: ForeachStage, workspaceDir: string): Promise<string[]> {
  const dot = stage.foreach.indexOf(".");
  const base = dot === -1 ? stage.foreach : stage.foreach.slice(0, dot);
  const key = dot === -1 ? "items" : stage.foreach.slice(dot + 1);
  const artifact = `${base}.json`;

  let raw: string;
  try {
    raw = await fs.readFile(path.join(workspaceDir, artifact), "utf-8");
  } catch {
    throw new Error(
      `Foreach stage "${stage.id}": artifact "${artifact}" not found; an earlier stage must produce it with a "${key}" array`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Foreach stage "${stage.id}": "${artifact}" is not valid JSON`);
  }

  const list = (parsed as Record<string, unknown>)[key];
  if (!Array.isArray(list)) {
    throw new Error(`Foreach stage "${stage.id}": "${artifact}" has no "${key}" array`);
  }

  const ids: string[] = [];
  for (const entry of list) {
    const id = (entry as Record<string, unknown>)?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Foreach stage "${stage.id}": every "${key}" entry needs a string id`);
    }
    ids.push(id);
  }
  return ids;
}
