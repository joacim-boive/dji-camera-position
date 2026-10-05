import { isPlainObject, valueType } from "../json.js";

export type JsonPathEntry = {
  path: string;
  type: string;
  preview: string;
};

export function listJsonPaths(value: unknown, maxPaths?: number): { entries: JsonPathEntry[]; total: number } {
  const entries: JsonPathEntry[] = [];
  walk(value, "$", entries);
  const total = entries.length;
  if (maxPaths !== undefined && entries.length > maxPaths) {
    return { entries: entries.slice(0, maxPaths), total };
  }
  return { entries, total };
}

export function searchJson(
  value: unknown,
  query: string,
  maxMatches: number,
): { hits: JsonPathEntry[]; truncated: boolean } {
  const needle = query.toLowerCase();
  const hits: JsonPathEntry[] = [];
  let truncated = false;

  const visit = (current: unknown, path: string): void => {
    if (hits.length >= maxMatches) {
      truncated = true;
      return;
    }
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        visit(current[index], `${path}[${index}]`);
        if (hits.length >= maxMatches) {
          truncated = true;
          return;
        }
      }
      return;
    }
    if (isPlainObject(current)) {
      for (const key of Object.keys(current)) {
        const next = path === "$" ? key : `${path}.${key}`;
        if (key.toLowerCase().includes(needle)) {
          hits.push({
            path: next,
            type: valueType(current[key]),
            preview: previewValue(current[key]),
          });
          if (hits.length >= maxMatches) {
            truncated = true;
            return;
          }
        }
        visit(current[key], next);
        if (hits.length >= maxMatches) {
          truncated = true;
          return;
        }
      }
      return;
    }
    if (primitiveMatches(current, needle)) {
      hits.push({
        path,
        type: valueType(current),
        preview: previewValue(current),
      });
    }
  };

  visit(value, "$");
  return { hits, truncated };
}

export function collectTypeTags(value: unknown): string[] {
  const tags = new Set<string>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }
    if (!isPlainObject(current)) {
      return;
    }
    const tag = current.__type__;
    if (typeof tag === "string") {
      tags.add(tag);
    }
    for (const child of Object.values(current)) {
      visit(child);
    }
  };
  visit(value);
  return [...tags].sort();
}

function walk(value: unknown, path: string, entries: JsonPathEntry[]): void {
  if (Array.isArray(value)) {
    entries.push({ path, type: `array(${value.length})`, preview: "" });
    for (let index = 0; index < value.length; index += 1) {
      walk(value[index], `${path}[${index}]`, entries);
    }
    return;
  }
  if (isPlainObject(value)) {
    if (path !== "$") {
      entries.push({ path, type: "object", preview: "" });
    }
    for (const key of Object.keys(value)) {
      const next = path === "$" ? key : `${path}.${key}`;
      walk(value[key], next, entries);
    }
    return;
  }
  entries.push({ path, type: valueType(value), preview: previewValue(value) });
}

function primitiveMatches(value: unknown, needle: string): boolean {
  if (typeof value === "string") {
    return value.toLowerCase().includes(needle);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(needle);
  }
  return false;
}

function previewValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (isPlainObject(value)) {
    return `object keys: ${Object.keys(value).slice(0, 8).join(", ")}`;
  }
  return valueType(value);
}
