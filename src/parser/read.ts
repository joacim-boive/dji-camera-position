import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { HEADER_BYTES, JSON_PARSE_LIMIT_BYTES } from "../policy.js";
import { parseJsonText } from "../json.js";
import { classifyBuffer, type FileType } from "./classify.js";

export type FileHeader = {
  fileType: FileType;
  bytes: number;
  modifiedAtMs: number;
  prefix: Buffer;
};

export async function readFileHeader(filePath: string): Promise<FileHeader> {
  const info = await stat(filePath);
  const handle = await open(filePath, "r");
  try {
    const prefix = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(prefix, 0, HEADER_BYTES, 0);
    const slice = prefix.subarray(0, bytesRead);
    return {
      fileType: classifyBuffer(slice, path.basename(filePath)),
      bytes: info.size,
      modifiedAtMs: info.mtimeMs,
      prefix: Buffer.from(slice),
    };
  } finally {
    await handle.close();
  }
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const info = await stat(filePath);
  if (info.size > JSON_PARSE_LIMIT_BYTES) {
    throw new Error(
      `${filePath} is ${info.size} bytes, above the ${JSON_PARSE_LIMIT_BYTES} byte JSON parse limit.`,
    );
  }
  const text = await readFile(filePath, "utf8");
  try {
    return parseJsonText(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }
}
