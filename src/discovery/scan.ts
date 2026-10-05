import { lstat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isPlainObject } from "../json.js";
import type { FileType } from "../parser/classify.js";
import { readPlistJson } from "../parser/plist.js";
import { readFileHeader } from "../parser/read.js";
import {
  INTERESTING_EXTENSIONS,
  MEDIA_EXTENSIONS,
  SKIP_DIRECTORY_NAMES,
  SUMMARIZE_DIRECTORY_NAMES,
} from "../policy.js";
import { nameMatches } from "./match.js";

export type InstalledApp = {
  path: string;
  name: string;
  bundleId?: string;
  version?: string;
  build?: string;
};

export type DiscoveredFile = {
  path: string;
  relativePath: string;
  fileType: FileType;
  bytes: number;
  modifiedAtMs: number;
};

export type DirectorySummary = {
  path: string;
  relativePath: string;
  reason: "skipped-bulky" | "summarized";
  fileCount: number;
  directoryCount: number;
  extensionCounts: Record<string, number>;
};

export type DiscoveredLocation = {
  path: string;
  files: DiscoveredFile[];
  summaries: DirectorySummary[];
  unreadable: string[];
  truncated: boolean;
  error?: string;
};

export type DiscoverReport = {
  homeDir: string;
  roots: { path: string; exists: boolean }[];
  apps: InstalledApp[];
  tokens: string[];
  locations: DiscoveredLocation[];
};

export type DiscoverOptions = {
  homeDir?: string;
  applicationDirs?: string[];
  maxFilesPerLocation?: number;
  maxDepth?: number;
};

const RELATIVE_ROOTS = [
  "Library/Application Support",
  "Library/Containers",
  "Library/Group Containers",
  "Library/Preferences",
  "Movies",
  "Documents",
];

export async function discover(
  options: DiscoverOptions = {},
): Promise<DiscoverReport> {
  const homeDir = options.homeDir ?? os.homedir();
  const applicationDirs = options.applicationDirs ?? [
    path.join("/Applications"),
    path.join(homeDir, "Applications"),
  ];
  const apps = await findApps(applicationDirs);
  const tokens = tokensFromApps(apps);
  const roots = RELATIVE_ROOTS.map((relative) => path.join(homeDir, relative));
  const rootStatus: { path: string; exists: boolean }[] = [];
  const locations: DiscoveredLocation[] = [];

  for (const root of roots) {
    const exists = await pathExists(root);
    rootStatus.push({ path: root, exists });
    if (!exists) {
      continue;
    }
    const entries = await safeReaddir(root);
    for (const entry of entries) {
      if (!nameMatches(entry, tokens)) {
        continue;
      }
      locations.push(
        await collectLocation(path.join(root, entry), {
          maxFiles: options.maxFilesPerLocation ?? 400,
          maxDepth: options.maxDepth ?? 8,
          shallowFilesOnly: path.basename(root) === "Preferences",
        }),
      );
    }
  }

  return { homeDir, roots: rootStatus, apps, tokens, locations };
}

async function findApps(applicationDirs: string[]): Promise<InstalledApp[]> {
  const apps: InstalledApp[] = [];
  for (const directory of applicationDirs) {
    if (!(await pathExists(directory))) {
      continue;
    }
    const entries = await safeReaddir(directory);
    for (const entry of entries) {
      if (!entry.endsWith(".app") || !nameMatches(entry, [])) {
        continue;
      }
      const appPath = path.join(directory, entry);
      const plistPath = path.join(appPath, "Contents", "Info.plist");
      const app: InstalledApp = {
        path: appPath,
        name: entry.replace(/\.app$/, ""),
      };
      if (await pathExists(plistPath)) {
        try {
          const plist = await readPlistJson(plistPath);
          if (isPlainObject(plist)) {
            const bundleId = stringField(plist, "CFBundleIdentifier");
            const version = stringField(plist, "CFBundleShortVersionString");
            const build = stringField(plist, "CFBundleVersion");
            const displayName =
              stringField(plist, "CFBundleDisplayName") ??
              stringField(plist, "CFBundleName");
            if (bundleId !== undefined) {
              app.bundleId = bundleId;
            }
            if (version !== undefined) {
              app.version = version;
            }
            if (build !== undefined) {
              app.build = build;
            }
            if (displayName !== undefined) {
              app.name = displayName;
            }
          }
        } catch (error) {
          app.name = `${app.name} (Info.plist unreadable: ${error instanceof Error ? error.message : "error"})`;
        }
      }
      apps.push(app);
    }
  }
  return apps;
}

function tokensFromApps(apps: InstalledApp[]): string[] {
  const tokens = new Set<string>();
  for (const app of apps) {
    if (app.bundleId !== undefined) {
      tokens.add(app.bundleId);
    }
    if (app.name.length >= 8) {
      tokens.add(app.name);
    }
  }
  return [...tokens];
}

async function collectLocation(
  locationPath: string,
  options: { maxFiles: number; maxDepth: number; shallowFilesOnly: boolean },
): Promise<DiscoveredLocation> {
  const files: DiscoveredFile[] = [];
  const summaries: DirectorySummary[] = [];
  const unreadable: string[] = [];
  let truncated = false;
  let error: string | undefined;

  const info = await lstat(locationPath).catch((cause: unknown) => {
    error = cause instanceof Error ? cause.message : "unreadable";
    return undefined;
  });
  if (info === undefined) {
    return {
      path: locationPath,
      files,
      summaries,
      unreadable,
      truncated,
      ...(error === undefined ? {} : { error }),
    };
  }
  if (info.isSymbolicLink()) {
    return {
      path: locationPath,
      files,
      summaries,
      unreadable,
      truncated,
      error: "symlink, not followed",
    };
  }
  if (info.isFile()) {
    await recordFile(locationPath, locationPath, files, unreadable);
    return { path: locationPath, files, summaries, unreadable, truncated };
  }

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (
      truncated ||
      files.length >= options.maxFiles ||
      depth > options.maxDepth
    ) {
      truncated = depth > options.maxDepth || files.length >= options.maxFiles;
      return;
    }
    const entries = await safeReaddir(directory);
    if (options.shallowFilesOnly && depth > 0) {
      return;
    }
    for (const entry of entries) {
      if (files.length >= options.maxFiles) {
        truncated = true;
        return;
      }
      if (entry === ".DS_Store") {
        continue;
      }
      const fullPath = path.join(directory, entry);
      let child;
      try {
        child = await lstat(fullPath);
      } catch {
        continue;
      }
      if (child.isSymbolicLink()) {
        continue;
      }
      if (child.isDirectory()) {
        if (SKIP_DIRECTORY_NAMES.has(entry)) {
          summaries.push({
            path: fullPath,
            relativePath: path.relative(locationPath, fullPath),
            reason: "skipped-bulky",
            fileCount: 0,
            directoryCount: 0,
            extensionCounts: {},
          });
          continue;
        }
        if (
          SUMMARIZE_DIRECTORY_NAMES.has(entry) ||
          (entries.length > 300 &&
            entry !== "project" &&
            !entry.endsWith(".proj"))
        ) {
          summaries.push(await summarizeImmediate(fullPath, locationPath));
          continue;
        }
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!child.isFile()) {
        continue;
      }
      const extension = path.extname(entry).toLowerCase();
      if (MEDIA_EXTENSIONS.has(extension)) {
        continue;
      }
      const relativePath = path.relative(locationPath, fullPath);
      const inProject =
        relativePath.split(path.sep).includes("project") ||
        relativePath.includes(`${path.sep}draft.proj${path.sep}`) ||
        relativePath.endsWith(".proj");
      if (!INTERESTING_EXTENSIONS.has(extension) && !inProject) {
        continue;
      }
      if (extension === ".bookmark") {
        continue;
      }
      await recordFile(fullPath, locationPath, files, unreadable);
    }
  };

  await walk(locationPath, 0);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  return {
    path: locationPath,
    files,
    summaries,
    unreadable,
    truncated,
    ...(error === undefined ? {} : { error }),
  };
}

async function recordFile(
  fullPath: string,
  locationPath: string,
  files: DiscoveredFile[],
  unreadable: string[],
): Promise<void> {
  try {
    const header = await readFileHeader(fullPath);
    files.push({
      path: fullPath,
      relativePath:
        path.relative(locationPath, fullPath) || path.basename(fullPath),
      fileType: header.fileType,
      bytes: header.bytes,
      modifiedAtMs: header.modifiedAtMs,
    });
  } catch {
    unreadable.push(
      path.relative(locationPath, fullPath) || path.basename(fullPath),
    );
  }
}

async function summarizeImmediate(
  directory: string,
  locationPath: string,
): Promise<DirectorySummary> {
  const entries = await safeReaddir(directory);
  const extensionCounts: Record<string, number> = {};
  let fileCount = 0;
  let directoryCount = 0;
  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    let info;
    try {
      info = await lstat(fullPath);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      directoryCount += 1;
      continue;
    }
    if (!info.isFile()) {
      continue;
    }
    fileCount += 1;
    const extension = path.extname(entry).toLowerCase() || "(none)";
    extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1;
  }
  return {
    path: directory,
    relativePath: path.relative(locationPath, directory),
    reason: "summarized",
    fileCount,
    directoryCount,
    extensionCounts,
  };
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeReaddir(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
