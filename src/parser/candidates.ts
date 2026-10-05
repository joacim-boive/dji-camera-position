import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import {
  INTERESTING_EXTENSIONS,
  MEDIA_EXTENSIONS,
  SKIP_DIRECTORY_NAMES,
  SUMMARIZE_DIRECTORY_NAMES,
} from "../policy.js";
import type { FileType } from "./classify.js";
import { readFileHeader } from "./read.js";

export type CandidateFile = {
  path: string;
  relativePath: string;
  fileType: FileType;
  bytes: number;
  modifiedAtMs: number;
};

export type CandidateSkip = {
  path: string;
  relativePath: string;
  reason: string;
};

export type CandidateCollection = {
  root: string;
  files: CandidateFile[];
  skipped: CandidateSkip[];
  truncated: boolean;
};

export type CollectOptions = {
  maxFiles?: number;
  maxDepth?: number;
  deep?: boolean;
};

export async function collectCandidates(
  root: string,
  options: CollectOptions = {},
): Promise<CandidateCollection> {
  const maxFiles = options.maxFiles ?? 2000;
  const maxDepth = options.maxDepth ?? 8;
  const info = await lstat(root);
  if (info.isSymbolicLink()) {
    return {
      root,
      files: [],
      skipped: [{ path: root, relativePath: ".", reason: "symlink" }],
      truncated: false,
    };
  }
  if (info.isFile()) {
    const header = await readFileHeader(root);
    return {
      root,
      files: [
        {
          path: root,
          relativePath: path.basename(root),
          fileType: header.fileType,
          bytes: header.bytes,
          modifiedAtMs: header.modifiedAtMs,
        },
      ],
      skipped: [],
      truncated: false,
    };
  }

  const files: CandidateFile[] = [];
  const skipped: CandidateSkip[] = [];
  let truncated = false;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (truncated || depth > maxDepth) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      skipped.push({
        path: directory,
        relativePath: path.relative(root, directory) || ".",
        reason: error instanceof Error ? error.message : "unreadable",
      });
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (entry.name === ".DS_Store") {
        continue;
      }
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath);
      if (entry.isSymbolicLink()) {
        skipped.push({ path: fullPath, relativePath, reason: "symlink" });
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORY_NAMES.has(entry.name)) {
          skipped.push({
            path: fullPath,
            relativePath,
            reason: "skipped bulky directory",
          });
          continue;
        }
        if (!options.deep && SUMMARIZE_DIRECTORY_NAMES.has(entry.name)) {
          skipped.push({
            path: fullPath,
            relativePath,
            reason: "summarized directory",
          });
          continue;
        }
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (MEDIA_EXTENSIONS.has(extension)) {
        skipped.push({ path: fullPath, relativePath, reason: "media" });
        continue;
      }
      const insideProject =
        relativePath.split(path.sep).includes("project") ||
        relativePath.includes("draft.proj");
      if (
        !INTERESTING_EXTENSIONS.has(extension) &&
        !insideProject &&
        extension !== ".meta"
      ) {
        continue;
      }
      try {
        const header = await readFileHeader(fullPath);
        files.push({
          path: fullPath,
          relativePath,
          fileType: header.fileType,
          bytes: header.bytes,
          modifiedAtMs: header.modifiedAtMs,
        });
      } catch (error) {
        skipped.push({
          path: fullPath,
          relativePath,
          reason: error instanceof Error ? error.message : "unreadable",
        });
      }
    }
  };

  await walk(root, 0);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  return { root, files, skipped, truncated };
}
