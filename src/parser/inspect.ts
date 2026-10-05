import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPlainObject } from "../json.js";
import { displayPath, formatBytes, formatModified } from "../paths.js";
import { collectCandidates, type CandidateFile } from "./candidates.js";
import { hexPreview } from "./classify.js";
import { detectEnvelope } from "./envelope.js";
import { structuralFingerprint } from "./fingerprint.js";
import {
  collectTypeTags,
  listJsonPaths,
  searchJson,
  type JsonPathEntry,
} from "./json-tree.js";
import { readPlistJson } from "./plist.js";
import { readFileHeader, readJsonFile } from "./read.js";
import type { SqliteInspection } from "./sqlite.js";

export type InspectOptions = {
  maxPaths?: number;
  full?: boolean;
};

const DETAIL_NAMES = new Set([
  "draft.json",
  "manifest.json",
  "project_settings.json",
  "proj.db",
  "project.meta",
]);

export async function inspectTarget(
  target: string,
  options: InspectOptions = {},
): Promise<string> {
  const collection = await collectCandidates(target, {
    deep: options.full === true,
  });
  if (collection.files.length === 1 && collection.files[0]?.path === target) {
    const only = collection.files[0];
    return formatDetailedFile(only, options);
  }

  const lines = [
    "DJI Studio inspection (read-only)",
    "",
    `Path: ${displayPath(target)}`,
    "",
    `Candidates: ${collection.files.length}`,
  ];
  if (collection.truncated) {
    lines.push(
      "Listing stopped at the file cap. Pass a narrower directory, or --full where it disables directory summaries.",
    );
  }

  const counts = new Map<string, number>();
  for (const file of collection.files) {
    counts.set(file.fileType, (counts.get(file.fileType) ?? 0) + 1);
  }
  if (counts.size > 0) {
    lines.push("");
    lines.push("By type:");
    for (const [fileType, count] of [...counts.entries()].sort()) {
      lines.push(`  ${fileType}: ${count}`);
    }
  }

  const skipCounts = new Map<string, number>();
  for (const skip of collection.skipped) {
    skipCounts.set(skip.reason, (skipCounts.get(skip.reason) ?? 0) + 1);
  }
  if (skipCounts.size > 0) {
    lines.push("");
    lines.push("Not opened:");
    for (const [reason, count] of [...skipCounts.entries()].sort()) {
      lines.push(`  ${reason}: ${count}`);
    }
  }

  lines.push("");
  lines.push("Files:");
  for (const file of collection.files) {
    lines.push(
      `  ${file.relativePath}  ${file.fileType}  ${formatBytes(file.bytes)}  ${formatModified(file.modifiedAtMs)}`,
    );
  }

  const detailed = collection.files.filter((file) => shouldDetail(file));
  for (const file of detailed) {
    lines.push("");
    lines.push(await formatDetailedFile(file, options));
  }

  if (detailed.length === 0) {
    lines.push("");
    lines.push("Pass a specific file to pretty-print it or list every key.");
  }

  return lines.join("\n");
}

export async function keysTarget(
  target: string,
  maxPaths?: number,
): Promise<string> {
  const files = await jsonLikeFiles(target);
  const lines: string[] = [];
  for (const file of files) {
    let value: unknown;
    try {
      value = await loadStructured(file);
    } catch (error) {
      lines.push(displayPath(file.path));
      lines.push(`  ${error instanceof Error ? error.message : "unreadable"}`);
      lines.push("");
      continue;
    }
    const listed = listJsonPaths(value, maxPaths);
    lines.push(displayPath(file.path));
    lines.push(`  ${listed.total} paths`);
    for (const entry of listed.entries) {
      lines.push(formatPathEntry(entry));
    }
    if (listed.total > listed.entries.length) {
      lines.push(
        `  ... ${listed.total - listed.entries.length} more. Use --all to print every path.`,
      );
    }
    lines.push("");
  }
  if (files.length === 0) {
    return "No JSON, plist, or SQLite files found.";
  }
  return lines.join("\n").trimEnd();
}

export async function searchTarget(
  target: string,
  query: string,
  maxMatches: number,
): Promise<string> {
  const collection = await collectCandidates(target);
  const lines = [
    `Search ${JSON.stringify(query)} in ${displayPath(target)}`,
    "",
  ];
  let remaining = maxMatches;
  let hitCount = 0;

  for (const file of collection.files) {
    if (remaining <= 0) {
      break;
    }
    if (
      file.fileType === "json" ||
      file.fileType === "plist-xml" ||
      file.fileType === "plist-binary" ||
      file.fileType === "sqlite"
    ) {
      let value: unknown;
      try {
        value = await loadStructured(file);
      } catch (error) {
        lines.push(
          `${file.relativePath}: ${error instanceof Error ? error.message : "unreadable"}`,
        );
        lines.push("");
        continue;
      }
      const result = searchJson(value, query, remaining);
      if (result.hits.length === 0) {
        continue;
      }
      lines.push(file.relativePath);
      for (const hit of result.hits) {
        lines.push(`  ${hit.path}  ${hit.type}  ${hit.preview}`);
      }
      hitCount += result.hits.length;
      remaining -= result.hits.length;
      lines.push("");
      continue;
    }
    if (file.fileType === "text" || file.fileType === "ini") {
      const text = await readFile(file.path, "utf8");
      const matches = text
        .split(/\r?\n/)
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) =>
          entry.line.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, remaining);
      if (matches.length === 0) {
        continue;
      }
      lines.push(file.relativePath);
      for (const match of matches) {
        lines.push(`  line ${match.number}: ${match.line.slice(0, 160)}`);
      }
      hitCount += matches.length;
      remaining -= matches.length;
      lines.push("");
    }
  }

  if (hitCount === 0) {
    lines.push("No matches.");
  } else if (remaining <= 0) {
    lines.push(`Stopped after ${maxMatches} matches.`);
  }
  return lines.join("\n").trimEnd();
}

function shouldDetail(file: CandidateFile): boolean {
  return DETAIL_NAMES.has(path.basename(file.path));
}

async function formatDetailedFile(
  file: CandidateFile,
  options: InspectOptions,
): Promise<string> {
  const header = await readFileHeader(file.path);
  const lines = [
    displayPath(file.path),
    `  type: ${header.fileType}`,
    `  size: ${formatBytes(header.bytes)}`,
    `  modified: ${formatModified(header.modifiedAtMs)}`,
    `  header: ${hexPreview(header.prefix)}`,
  ];

  if (header.fileType === "json") {
    const value = await readJsonFile(file.path);
    lines.push(...describeJson(value, options));
  } else if (
    header.fileType === "plist-xml" ||
    header.fileType === "plist-binary"
  ) {
    const value = await readPlistJson(file.path);
    lines.push(...describeJson(value, options));
  } else if (header.fileType === "sqlite") {
    const { inspectSqlite } = await import("./sqlite.js");
    lines.push(...describeSqlite(inspectSqlite(file.path)));
  } else if (header.fileType === "ini" || header.fileType === "text") {
    const text = await readFile(file.path, "utf8");
    lines.push("");
    lines.push(options.full === true ? text : truncate(text, 4000));
  } else if (header.fileType === "macos-bookmark") {
    lines.push("  macOS bookmark (header starts with 'book'). Not resolved.");
  } else if (header.fileType === "protobuf-extension") {
    lines.push(
      "  extension suggests protobuf; the message schema is not known and the payload was not decoded.",
    );
  } else {
    lines.push(`  no structured decoder for ${header.fileType}`);
  }

  return lines.join("\n");
}

function describeJson(value: unknown, options: InspectOptions): string[] {
  const lines: string[] = [];
  const envelope = detectEnvelope(value);
  lines.push(`  structural fingerprint: ${structuralFingerprint(value)}`);
  if (envelope.isEnvelope) {
    lines.push("  wrapped document: signature, signature_method, data");
    if (envelope.signatureMethod !== undefined) {
      lines.push(`  signature_method: ${envelope.signatureMethod}`);
    }
    if (envelope.signature !== undefined) {
      lines.push(`  signature: ${envelope.signature}`);
    }
    if (envelope.dataKeys.length > 0) {
      lines.push(`  data keys: ${envelope.dataKeys.join(", ")}`);
    }
    if (envelope.extraKeys.length > 0) {
      lines.push(
        `  extra wrapper keys preserved: ${envelope.extraKeys.join(", ")}`,
      );
    }
    for (const note of envelope.notes) {
      lines.push(`  note: ${note}`);
    }
  } else if (isPlainObject(value)) {
    lines.push(`  top-level keys: ${Object.keys(value).join(", ")}`);
  }

  const tags = collectTypeTags(value);
  if (tags.length > 0) {
    lines.push(`  __type__ values: ${tags.join(", ")}`);
  }

  const listed = listJsonPaths(
    value,
    options.full === true ? undefined : (options.maxPaths ?? 40),
  );
  lines.push(`  paths: ${listed.total}`);
  for (const entry of listed.entries.slice(
    0,
    options.full === true ? listed.entries.length : 40,
  )) {
    lines.push(formatPathEntry(entry));
  }
  if (!options.full && listed.total > listed.entries.length) {
    lines.push(
      `  ... ${listed.total - listed.entries.length} more paths. Use keys or --full.`,
    );
  }

  if (options.full === true) {
    lines.push("");
    lines.push(truncate(JSON.stringify(value, null, 2), 80_000));
  }
  return lines;
}

function describeSqlite(inspection: SqliteInspection): string[] {
  const lines: string[] = [];
  if (inspection.tables.length === 0) {
    lines.push("  no user tables");
    return lines;
  }
  for (const table of inspection.tables) {
    lines.push(`  table ${table.name}  rows ${table.rowCount}`);
    lines.push(
      `    columns: ${table.columns.map((column) => column.name).join(", ")}`,
    );
    for (const row of table.sampleRows) {
      lines.push(`    row: ${truncate(JSON.stringify(row), 300)}`);
    }
  }
  return lines;
}

async function jsonLikeFiles(target: string): Promise<CandidateFile[]> {
  const collection = await collectCandidates(target);
  return collection.files.filter(
    (file) =>
      file.fileType === "json" ||
      file.fileType === "plist-xml" ||
      file.fileType === "plist-binary" ||
      file.fileType === "sqlite",
  );
}

async function loadStructured(file: CandidateFile): Promise<unknown> {
  if (file.fileType === "sqlite") {
    const { sqliteToJson } = await import("./sqlite.js");
    return sqliteToJson(file.path);
  }
  if (file.fileType === "plist-xml" || file.fileType === "plist-binary") {
    return readPlistJson(file.path);
  }
  return readJsonFile(file.path);
}

function formatPathEntry(entry: JsonPathEntry): string {
  const preview = entry.preview.length > 0 ? `  ${entry.preview}` : "";
  return `  ${entry.path}  ${entry.type}${preview}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... truncated`;
}
