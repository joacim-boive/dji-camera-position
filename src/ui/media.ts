import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

export const missingProxySentence = "This clip has no .LRF next to its .OSV.";
export const missingFfmpegSentence =
  "ffmpeg is required to prepare the preview.";
export const remuxFailedSentence = "The preview proxy could not be prepared.";

const jobs = new Map<string, Promise<string>>();

export function proxyCacheKey(
  realPath: string,
  size: number,
  mtimeMs: number,
): string {
  const text = `${realPath}\0${size}\0${Math.trunc(mtimeMs)}`;
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function parseByteRange(
  header: string | undefined,
  size: number,
):
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" } {
  if (header === undefined) {
    return { kind: "full" };
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || size <= 0) {
    return { kind: "unsatisfiable" };
  }
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText.length === 0 && endText.length === 0) {
    return { kind: "unsatisfiable" };
  }
  if (startText.length === 0) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      return { kind: "unsatisfiable" };
    }
    const start = Math.max(0, size - suffix);
    return { kind: "partial", start, end: size - 1 };
  }
  const start = Number(startText);
  if (!Number.isInteger(start) || start < 0 || start >= size) {
    return { kind: "unsatisfiable" };
  }
  const end =
    endText.length === 0 ? size - 1 : Math.min(size - 1, Number(endText));
  if (!Number.isInteger(end) || end < start) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "partial", start, end };
}

export async function preparedProxy(
  realPath: string,
  size: number,
  mtimeMs: number,
): Promise<string> {
  const hash = proxyCacheKey(realPath, size, mtimeMs);
  const target = path.join(os.tmpdir(), "frame-desk-proxies", `${hash}.mp4`);
  if (await fileExists(target)) {
    return target;
  }
  const running = jobs.get(hash);
  if (running !== undefined) {
    return running;
  }
  const job = remuxToCache(realPath, target);
  jobs.set(hash, job);
  void job.then(
    () => jobs.delete(hash),
    () => jobs.delete(hash),
  );
  return job;
}

export async function sendVideo(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
): Promise<void> {
  const info = await stat(filePath);
  const size = info.size;
  const range = parseByteRange(request.headers.range, size);
  if (range.kind === "unsatisfiable") {
    response.writeHead(416, {
      "content-range": `bytes */${size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    response.end();
    return;
  }
  const start = range.kind === "partial" ? range.start : 0;
  const end = range.kind === "partial" ? range.end : size - 1;
  const status = range.kind === "partial" ? 206 : 200;
  response.writeHead(status, {
    "content-type": "video/mp4",
    "content-length": String(end - start + 1),
    "accept-ranges": "bytes",
    ...(range.kind === "partial"
      ? { "content-range": `bytes ${start}-${end}/${size}` }
      : {}),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { start, end });
    stream.on("error", reject);
    response.on("close", () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(response);
  });
}

async function remuxToCache(input: string, target: string): Promise<string> {
  const directory = path.dirname(target);
  const part = `${target}.part`;
  await mkdir(directory, { recursive: true });
  try {
    await runFfmpeg(input, part);
    await rename(part, target);
    return target;
  } catch (error) {
    await unlink(part).catch(() => undefined);
    throw error;
  }
}

function runFfmpeg(input: string, outputPart: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-c",
        "copy",
        "-an",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        outputPart,
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0) {
        settled = true;
        resolve();
        return;
      }
      fail(new Error("ffmpeg failed"));
    });
  });
}

export function remuxSentence(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return missingFfmpegSentence;
  }
  return remuxFailedSentence;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}
