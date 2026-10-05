export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonText(text: string): unknown {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(withoutBom) as unknown;
}

export function valueType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

export function lastPathKey(path: string): string {
  const withoutIndexes = path.replace(/\[\d+\]/g, "");
  const parts = withoutIndexes.split(".").filter((part) => part.length > 0 && part !== "$");
  return parts.at(-1) ?? path;
}

export function formatLeaf(value: unknown, maxLength = 400): string {
  if (typeof value === "string") {
    const shown = value.length > 120 ? `${value.slice(0, 117)}...` : value;
    return JSON.stringify(shown);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }
  const text = JSON.stringify(value);
  if (text === undefined) {
    return String(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
