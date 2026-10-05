import { lastPathKey } from "../json.js";

export type NoiseReason =
  | "noise-key"
  | "uuid"
  | "timestamp"
  | "filesystem-path";

const NOISE_KEYS = new Set([
  "signature",
  "checksum",
  "filemd5",
  "md5",
  "uuid",
  "guid",
  "id",
  "draft_id",
  "project_data_id",
  "created_at",
  "createdat",
  "updated_at",
  "updatedat",
  "modified_at",
  "modifiedat",
  "createtime",
  "importtime",
  "editortime",
  "lastmodified",
  "lastopened",
  "mtime",
  "accessedat",
  "timestamp",
  "sessionid",
  "session_id",
  "cachepath",
  "cache_path",
  "previewpath",
  "thumbnailpath",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}:\d{2}/;

export function noiseReason(
  path: string,
  before: unknown,
  after: unknown,
): NoiseReason | undefined {
  const key = lastPathKey(path).toLowerCase();
  if (
    NOISE_KEYS.has(key) ||
    key.includes("timestamp") ||
    key.includes("create_time") ||
    key.includes("createtime")
  ) {
    return "noise-key";
  }
  if (isUuid(before) && isUuid(after)) {
    return "uuid";
  }
  if (isTimestamp(before) && isTimestamp(after)) {
    return "timestamp";
  }
  if (isFilesystemPath(before) || isFilesystemPath(after)) {
    return "filesystem-path";
  }
  return undefined;
}

function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): boolean {
  return typeof value === "string" && ISO_TIMESTAMP.test(value);
}

function isFilesystemPath(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return (
    value.startsWith("/Users/") ||
    value.startsWith("/var/") ||
    value.startsWith("/tmp/") ||
    value.startsWith("/private/") ||
    value.startsWith("/Volumes/") ||
    value.includes("/Library/") ||
    value.includes("\\AppData\\") ||
    /^[A-Za-z]:\\/.test(value)
  );
}
