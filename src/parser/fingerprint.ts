import { createHash } from "node:crypto";
import { isPlainObject, valueType } from "../json.js";

/**
 * Hash of key paths and leaf types, ignoring values and array indexes.
 * This is a comparison aid. It is not yet an allowlist of supported schemas.
 */
export function structuralFingerprint(value: unknown): string {
  const paths = new Set<string>();
  collectStructure(value, "$", paths);
  const lines = [...paths].sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12);
}

function collectStructure(value: unknown, path: string, paths: Set<string>): void {
  if (Array.isArray(value)) {
    paths.add(`${path}[]`);
    for (const item of value) {
      collectStructure(item, `${path}[]`, paths);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value).sort()) {
      const next = path === "$" ? key : `${path}.${key}`;
      const child = value[key];
      if (key === "__type__" && typeof child === "string") {
        paths.add(`${next}=${child}`);
        continue;
      }
      paths.add(next);
      collectStructure(child, next, paths);
    }
    return;
  }
  paths.add(`${path}:${valueType(value)}`);
}
