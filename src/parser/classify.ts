import path from "node:path";

export type FileType =
  | "json"
  | "plist-xml"
  | "plist-binary"
  | "sqlite"
  | "ini"
  | "macos-bookmark"
  | "gzip"
  | "zip"
  | "text"
  | "protobuf-extension"
  | "empty"
  | "binary"
  | "directory"
  | "symlink";

export function classifyBuffer(buffer: Buffer, fileName: string): FileType {
  if (buffer.length === 0) {
    return "empty";
  }
  if (buffer.subarray(0, 15).toString("utf8") === "SQLite format 3") {
    return "sqlite";
  }
  if (buffer.subarray(0, 6).toString("utf8") === "bplist") {
    return "plist-binary";
  }
  if (buffer.subarray(0, 4).toString("utf8") === "book") {
    return "macos-bookmark";
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return "gzip";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  ) {
    return "zip";
  }

  const head = buffer
    .subarray(0, Math.min(buffer.length, 512))
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();

  if (head.startsWith("<?xml") && /<plist[\s>]/.test(head)) {
    return "plist-xml";
  }
  if (head.startsWith("{") || looksLikeJsonArray(head)) {
    return "json";
  }

  const extension = path.extname(fileName).toLowerCase();
  if (
    (extension === ".pb" || extension === ".protobuf") &&
    !isMostlyText(buffer)
  ) {
    return "protobuf-extension";
  }
  if (extension === ".ini" || looksLikeIni(head)) {
    return "ini";
  }
  if (isMostlyText(buffer)) {
    return "text";
  }
  return "binary";
}

function looksLikeJsonArray(head: string): boolean {
  if (!head.startsWith("[")) {
    return false;
  }
  const next = head.slice(1).trimStart().charAt(0);
  return (
    next === "" ||
    next === "]" ||
    next === '"' ||
    next === "{" ||
    next === "[" ||
    next === "-" ||
    (next >= "0" && next <= "9") ||
    next === "t" ||
    next === "f" ||
    next === "n"
  );
}

function looksLikeIni(head: string): boolean {
  const lines = head
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith("#") && !line.startsWith(";"),
    );
  const sample = lines.slice(0, 4);
  if (sample.length === 0) {
    return false;
  }
  return sample.every(
    (line) => /^[A-Za-z0-9_.[\]-]+\s*=/.test(line) || /^\[[^\]]+\]$/.test(line),
  );
}

function isMostlyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  if (sample.includes(0)) {
    return false;
  }
  let printable = 0;
  for (const byte of sample) {
    if (
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      (byte >= 32 && byte < 127)
    ) {
      printable += 1;
    }
  }
  return printable / sample.length > 0.9;
}

export function hexPreview(buffer: Buffer, bytes = 16): string {
  return [...buffer.subarray(0, Math.min(buffer.length, bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}
