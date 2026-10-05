import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { collectCandidates, type CandidateFile } from "../parser/candidates.js";
import { classifyBuffer, type FileType } from "../parser/classify.js";
import { readPlistJson } from "../parser/plist.js";
import { readJsonFile } from "../parser/read.js";
import { displayPath } from "../paths.js";
import { formatSemanticDiff } from "./format.js";
import { diffValues, type SemanticDiff } from "./semantic-diff.js";

export type FilePairing = "relative-path" | "unique-filename" | "direct";

export type FileComparison = {
  label: string;
  beforePath: string;
  afterPath: string;
  pairing: FilePairing;
  status:
    | "identical"
    | "semantic"
    | "text"
    | "binary"
    | "type-changed"
    | "error";
  semantic?: SemanticDiff;
  text?: { added: string[]; removed: string[] };
  note?: string;
};

export type ComparisonReport = {
  before: string;
  after: string;
  files: FileComparison[];
  unmatchedBefore: string[];
  unmatchedAfter: string[];
  mediaSkipped: number;
};

export type CompareOptions = {
  includeNoise?: boolean;
  maxChanges?: number;
};

export async function comparePaths(
  beforePath: string,
  afterPath: string,
  options: CompareOptions = {},
): Promise<ComparisonReport> {
  const beforeStat = await lstat(beforePath);
  const afterStat = await lstat(afterPath);
  if (beforeStat.isSymbolicLink() || afterStat.isSymbolicLink()) {
    throw new Error(
      "Refusing to follow symlinks. Pass the real project file or directory.",
    );
  }
  if (beforeStat.isFile() && afterStat.isFile()) {
    const comparison = await compareFilePair(
      beforePath,
      afterPath,
      "direct",
      path.basename(beforePath),
      options,
    );
    return {
      before: beforePath,
      after: afterPath,
      files: [comparison],
      unmatchedBefore: [],
      unmatchedAfter: [],
      mediaSkipped: 0,
    };
  }
  if (beforeStat.isDirectory() && afterStat.isDirectory()) {
    return compareDirectories(beforePath, afterPath, options);
  }
  throw new Error("Diff expects two files or two directories.");
}

export function formatComparison(
  report: ComparisonReport,
  maxChanges = 200,
): string {
  const lines: string[] = [
    "DJI Studio diff (read-only)",
    "",
    `Before: ${displayPath(report.before)}`,
    `After:  ${displayPath(report.after)}`,
    "",
  ];

  const identical = report.files.filter((file) => file.status === "identical");
  const changed = report.files.filter((file) => file.status !== "identical");

  if (report.files.length === 0) {
    lines.push("No comparable project files were found.");
  } else {
    lines.push(
      `${changed.length} file${changed.length === 1 ? "" : "s"} differ, ${identical.length} identical.`,
    );
  }

  if (identical.length > 0) {
    lines.push("");
    lines.push("Identical:");
    for (const file of identical) {
      lines.push(`  ${file.label}`);
    }
  }

  for (const file of changed) {
    lines.push("");
    lines.push(formatFileComparison(file, maxChanges));
  }

  if (report.unmatchedBefore.length > 0 || report.unmatchedAfter.length > 0) {
    lines.push("");
    lines.push("Unmatched files:");
    for (const filePath of report.unmatchedBefore) {
      lines.push(`  only before: ${filePath}`);
    }
    for (const filePath of report.unmatchedAfter) {
      lines.push(`  only after:  ${filePath}`);
    }
  }

  if (report.mediaSkipped > 0) {
    lines.push("");
    lines.push(`Media files not compared: ${report.mediaSkipped}`);
  }

  return lines.join("\n").trimEnd();
}

async function compareDirectories(
  beforeRoot: string,
  afterRoot: string,
  options: CompareOptions,
): Promise<ComparisonReport> {
  const [before, after] = await Promise.all([
    collectCandidates(beforeRoot),
    collectCandidates(afterRoot),
  ]);
  const pairs = pairCandidates(before.files, after.files);
  const files: FileComparison[] = [];
  for (const pair of pairs.paired) {
    files.push(
      await compareFilePair(
        pair.before.path,
        pair.after.path,
        pair.pairing,
        pair.label,
        options,
      ),
    );
  }
  return {
    before: beforeRoot,
    after: afterRoot,
    files,
    unmatchedBefore: pairs.unmatchedBefore,
    unmatchedAfter: pairs.unmatchedAfter,
    mediaSkipped:
      before.skipped.filter((skip) => skip.reason === "media").length +
      after.skipped.filter((skip) => skip.reason === "media").length,
  };
}

type PairedCandidate = {
  before: CandidateFile;
  after: CandidateFile;
  pairing: FilePairing;
  label: string;
};

function pairCandidates(
  beforeFiles: CandidateFile[],
  afterFiles: CandidateFile[],
): {
  paired: PairedCandidate[];
  unmatchedBefore: string[];
  unmatchedAfter: string[];
} {
  const afterByRelative = new Map(
    afterFiles.map((file) => [file.relativePath, file]),
  );
  const paired: PairedCandidate[] = [];
  const unmatchedBefore: CandidateFile[] = [];
  const matchedAfter = new Set<string>();

  for (const before of beforeFiles) {
    const after = afterByRelative.get(before.relativePath);
    if (after === undefined) {
      unmatchedBefore.push(before);
      continue;
    }
    matchedAfter.add(after.relativePath);
    paired.push({
      before,
      after,
      pairing: "relative-path",
      label: before.relativePath,
    });
  }

  const unmatchedAfter = afterFiles.filter(
    (file) => !matchedAfter.has(file.relativePath),
  );
  const beforeByName = uniqueByBaseName(unmatchedBefore);
  const afterByName = uniqueByBaseName(unmatchedAfter);
  const consumedBefore = new Set<string>();
  const consumedAfter = new Set<string>();

  for (const [name, before] of beforeByName) {
    const after = afterByName.get(name);
    if (after === undefined) {
      continue;
    }
    consumedBefore.add(before.relativePath);
    consumedAfter.add(after.relativePath);
    paired.push({
      before,
      after,
      pairing: "unique-filename",
      label: `${name} (${before.relativePath} -> ${after.relativePath})`,
    });
  }

  return {
    paired,
    unmatchedBefore: unmatchedBefore
      .filter((file) => !consumedBefore.has(file.relativePath))
      .map((file) => file.relativePath),
    unmatchedAfter: unmatchedAfter
      .filter((file) => !consumedAfter.has(file.relativePath))
      .map((file) => file.relativePath),
  };
}

function uniqueByBaseName(files: CandidateFile[]): Map<string, CandidateFile> {
  const groups = new Map<string, CandidateFile[]>();
  for (const file of files) {
    const name = path.basename(file.path);
    const group = groups.get(name) ?? [];
    group.push(file);
    groups.set(name, group);
  }
  const unique = new Map<string, CandidateFile>();
  for (const [name, group] of groups) {
    const only = group[0];
    if (group.length === 1 && only !== undefined) {
      unique.set(name, only);
    }
  }
  return unique;
}

async function compareFilePair(
  beforePath: string,
  afterPath: string,
  pairing: FilePairing,
  label: string,
  options: CompareOptions,
): Promise<FileComparison> {
  const beforeBytes = await readFile(beforePath);
  const afterBytes = await readFile(afterPath);
  const base: FileComparison = {
    label,
    beforePath,
    afterPath,
    pairing,
    status: "identical",
  };
  if (beforeBytes.equals(afterBytes)) {
    return base;
  }

  const beforeType = classifyBuffer(
    beforeBytes.subarray(0, 512),
    path.basename(beforePath),
  );
  const afterType = classifyBuffer(
    afterBytes.subarray(0, 512),
    path.basename(afterPath),
  );
  if (beforeType !== afterType) {
    return {
      ...base,
      status: "type-changed",
      note: `${beforeType} -> ${afterType}`,
    };
  }

  try {
    if (beforeType === "json") {
      return semantic(
        base,
        await readJsonFile(beforePath),
        await readJsonFile(afterPath),
        options,
      );
    }
    if (beforeType === "plist-xml" || beforeType === "plist-binary") {
      return semantic(
        base,
        await readPlistJson(beforePath),
        await readPlistJson(afterPath),
        options,
      );
    }
    if (beforeType === "sqlite") {
      const { sqliteToJson } = await import("../parser/sqlite.js");
      return semantic(
        base,
        sqliteToJson(beforePath),
        sqliteToJson(afterPath),
        options,
      );
    }
    if (beforeType === "text" || beforeType === "ini") {
      return {
        ...base,
        status: "text",
        text: lineDiff(
          beforeBytes.toString("utf8"),
          afterBytes.toString("utf8"),
        ),
      };
    }
  } catch (error) {
    return {
      ...base,
      status: "error",
      note: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ...base,
    status: "binary",
    note: `${describeBinary(beforeType)} ${beforeBytes.length} bytes -> ${afterBytes.length} bytes`,
  };
}

function semantic(
  base: FileComparison,
  before: unknown,
  after: unknown,
  options: CompareOptions,
): FileComparison {
  return {
    ...base,
    status: "semantic",
    semantic: diffValues(before, after, {
      includeNoise: options.includeNoise === true,
    }),
  };
}

function describeBinary(fileType: FileType): string {
  return fileType;
}

function lineDiff(
  before: string,
  after: string,
): { added: string[]; removed: string[] } {
  const beforeLines = new Set(
    before.split(/\r?\n/).filter((line) => line.length > 0),
  );
  const afterLines = new Set(
    after.split(/\r?\n/).filter((line) => line.length > 0),
  );
  return {
    removed: [...beforeLines]
      .filter((line) => !afterLines.has(line))
      .slice(0, 40),
    added: [...afterLines]
      .filter((line) => !beforeLines.has(line))
      .slice(0, 40),
  };
}

function formatFileComparison(
  file: FileComparison,
  maxChanges: number,
): string {
  const lines = [file.label];
  if (file.pairing === "unique-filename") {
    lines.push("  paired by filename because the relative paths differ");
  }
  if (
    file.status === "type-changed" ||
    file.status === "binary" ||
    file.status === "error"
  ) {
    lines.push(`  ${file.note ?? file.status}`);
    return lines.join("\n");
  }
  if (file.status === "text" && file.text !== undefined) {
    lines.push("  text differs");
    for (const line of file.text.removed) {
      lines.push(`  - ${line}`);
    }
    for (const line of file.text.added) {
      lines.push(`  + ${line}`);
    }
    return lines.join("\n");
  }
  if (file.semantic !== undefined) {
    lines.push(indent(formatSemanticDiff(file.semantic, maxChanges)));
  }
  return lines.join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? "" : `  ${line}`))
    .join("\n");
}
