import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPlainObject, parseJsonText } from "../json.js";
import type { CameraView } from "../model/camera-view.js";
import {
  offsetWithPatch,
  tuplesEqual,
  viewFromOffset,
} from "../model/camera-view.js";
import {
  clipAt,
  readDraftViews,
  resolveDraftFile,
  writeClipView,
  writeClipViews,
  type DraftViewReport,
} from "../model/draft-document.js";
import {
  formatCorrection,
  formatDegrees,
  formatMicros,
} from "../model/format-view.js";
import { lrfIsPresent } from "../model/proxy.js";
import { resolveUserPath } from "../paths.js";
import {
  defaultPresetLibraryPath,
  deletePreset,
  loadPresetLibrary,
  presetNamed,
  savePreset,
} from "../presets/library.js";
import { assertStudioQuit, studioIsRunning } from "../studio.js";
import { listDraftProjects } from "./projects.js";

export type UiServerOptions = {
  port: number;
  host?: string;
  homeRoot?: string;
  projectRoot?: string;
  libraryPath?: string;
  checkStudio?: boolean;
  publicDir?: string;
  pickFolder?: () => Promise<string | null>;
};

export type UiServer = {
  url: string;
  close: () => Promise<void>;
};

const bundledPublicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

export async function startUiServer(
  options: UiServerOptions,
): Promise<UiServer> {
  const host = options.host ?? "127.0.0.1";
  const token = randomBytes(16).toString("hex");
  const homeRoot = options.homeRoot ?? os.homedir();
  const projectRoot =
    options.projectRoot ??
    path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "DJI Studio",
      "project",
    );
  const libraryPath = options.libraryPath ?? defaultPresetLibraryPath();
  const publicDir = options.publicDir ?? bundledPublicDir;
  const server = createServer((request, response) => {
    void handleRequest(request, response, {
      token,
      homeRoot,
      projectRoot,
      libraryPath,
      publicDir,
      checkStudio: options.checkStudio !== false,
      pickFolder: options.pickFolder,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("UI server did not bind to a port.");
  }
  const url = `http://${host}:${address.port}`;
  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

type ServerContext = {
  token: string;
  homeRoot: string;
  projectRoot: string;
  libraryPath: string;
  publicDir: string;
  checkStudio: boolean;
  pickFolder?: () => Promise<string | null>;
};

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ServerContext,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (
    request.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/index.html")
  ) {
    const html = await readFile(
      path.join(context.publicDir, "index.html"),
      "utf8",
    );
    sendText(
      response,
      200,
      html.replaceAll("__TOKEN__", context.token),
      "text/html; charset=utf-8",
    );
    return;
  }
  if (
    request.method === "GET" &&
    (url.pathname === "/app.css" || url.pathname === "/app.js")
  ) {
    const fileName = url.pathname.slice(1);
    const type = fileName.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8";
    sendText(
      response,
      200,
      await readFile(path.join(context.publicDir, fileName), "utf8"),
      type,
    );
    return;
  }
  if (!url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  if (request.method === "POST" || request.method === "DELETE") {
    if (request.headers["x-frame-desk"] !== context.token) {
      sendJson(response, 403, { error: "Missing frame desk token." });
      return;
    }
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/studio") {
      sendJson(response, 200, {
        running: await studioIsRunning(),
        pickFolder: context.pickFolder !== undefined,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/pick-folder") {
      if (context.pickFolder === undefined) {
        sendJson(response, 404, { error: "Folder picking is unavailable." });
        return;
      }
      sendJson(response, 200, { path: await context.pickFolder() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/projects") {
      sendJson(response, 200, {
        projects: await listDraftProjects(context.projectRoot),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/draft") {
      const target = url.searchParams.get("path") ?? "";
      const report = await readAllowedDraft(target, context.homeRoot);
      sendJson(response, 200, await draftJson(report));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/presets") {
      sendJson(response, 200, {
        presets: await loadPresetLibrary(context.libraryPath),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/preview") {
      const body = await readJson(request);
      const report = await readAllowedDraft(
        requiredString(body, "path"),
        context.homeRoot,
      );
      sendJson(
        response,
        200,
        previewDraft(report, requiredClip(body), readView(body)),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/write") {
      const body = await readJson(request);
      const draftPath = (
        await readAllowedDraft(requiredString(body, "path"), context.homeRoot)
      ).draftPath;
      if (context.checkStudio) {
        await assertStudioQuit();
      }
      const result = await writeClipView(
        draftPath,
        requiredClip(body),
        readView(body),
      );
      const report = await readDraftViews(draftPath);
      sendJson(response, 200, {
        changed: result.changed,
        ...(result.backupPath === undefined
          ? {}
          : { backupPath: result.backupPath }),
        before: result.before,
        after: result.after,
        draft: await draftJson(report),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/presets/apply") {
      const body = await readJson(request);
      const draftPath = (
        await readAllowedDraft(requiredString(body, "path"), context.homeRoot)
      ).draftPath;
      if (context.checkStudio) {
        await assertStudioQuit();
      }
      const preset = presetNamed(
        await loadPresetLibrary(context.libraryPath),
        requiredString(body, "name"),
      );
      const result = await writeClipViews(
        draftPath,
        readClipList(body),
        preset.view,
      );
      const report = await readDraftViews(draftPath);
      sendJson(response, 200, {
        changed: result.changed,
        updated: result.updated,
        unchanged: result.unchanged,
        ...(result.backupPath === undefined
          ? {}
          : { backupPath: result.backupPath }),
        draft: await draftJson(report),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/presets") {
      const body = await readJson(request);
      const saved = await savePreset(
        context.libraryPath,
        { name: requiredString(body, "name"), view: readView(body) },
        booleanField(body, "force"),
      );
      sendJson(response, 200, saved);
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/api/presets") {
      const body = await readJson(request);
      const name = await deletePreset(
        context.libraryPath,
        requiredString(body, "name"),
      );
      sendJson(response, 200, { name });
      return;
    }
    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 400, { error: message });
  }
}

export async function readAllowedDraft(
  target: string,
  homeRoot: string,
): Promise<DraftViewReport> {
  if (target.trim().length === 0) {
    throw new Error("Choose a project folder.");
  }
  const draftPath = await resolveDraftFile(resolveUserPath(target));
  const resolved = path.resolve(draftPath);
  const root = path.resolve(homeRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("That draft is outside the allowed folder.");
  }
  return readDraftViews(draftPath);
}

async function draftJson(report: DraftViewReport): Promise<{
  draftPath: string;
  signature: string;
  signatureMatches: boolean;
  clips: Array<{
    index: number;
    label: string;
    hasDirectionLockView: boolean;
    keyframeCount: number;
    view: CameraView;
    timeStart: number;
    timeEnd: number;
    proxyReady: boolean;
  }>;
}> {
  return {
    draftPath: report.draftPath,
    signature: report.signature,
    signatureMatches: report.signatureMatches,
    clips: await Promise.all(
      report.clips.map(async (clip) => ({
        index: clip.index,
        label: `${formatMicros(clip.timeStart)} – ${formatMicros(clip.timeEnd)}`,
        hasDirectionLockView: clip.hasDirectionLockView,
        keyframeCount: clip.keyframes.length,
        view: clip.view,
        timeStart: clip.timeStart,
        timeEnd: clip.timeEnd,
        proxyReady: await lrfIsPresent(clip.proxyPath),
      })),
    ),
  };
}

function previewDraft(
  report: DraftViewReport,
  clipIndex: number,
  view: CameraView,
): {
  changed: boolean;
  lines: string[];
  notes: string[];
} {
  const clip = clipAt(report.clips, clipIndex);
  const nextOffset = offsetWithPatch(clip.viewParam, clip.viewOffset, view);
  const after = viewFromOffset(clip.viewParam, nextOffset);
  const lines = changeLines(clip.view, after);
  const notes: string[] = [];
  if (clip.keyframes.length > 0) {
    notes.push(
      "This clip has keyframes. Writing updates the static view only.",
    );
  }
  if (clip.hasDirectionLockView) {
    notes.push("A direction-lock view is present and will be left unchanged.");
  }
  if (!report.signatureMatches) {
    notes.push("The crc32 signature does not match this draft.");
  }
  return { changed: !tuplesEqual(clip.viewOffset, nextOffset), lines, notes };
}

function changeLines(before: CameraView, after: CameraView): string[] {
  const rows: Array<[string, string, string]> = [
    ["Pan", formatDegrees(before.pan), formatDegrees(after.pan)],
    ["Tilt", formatDegrees(before.tilt), formatDegrees(after.tilt)],
    ["Roll", formatDegrees(before.roll), formatDegrees(after.roll)],
    ["FOV", formatDegrees(before.fov), formatDegrees(after.fov)],
    [
      "Correction",
      formatCorrection(before.correction),
      formatCorrection(after.correction),
    ],
  ];
  return rows
    .filter(([, from, to]) => from !== to)
    .map(([label, from, to]) => `${label}  ${from} → ${to}`);
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new Error("Request is too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const value = parseJsonText(Buffer.concat(chunks).toString("utf8"));
  if (!isPlainObject(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function readClipList(body: Record<string, unknown>): number[] {
  const value = body.clips;
  if (!Array.isArray(value)) {
    throw new Error("Check at least one clip.");
  }
  const clips: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1) {
      throw new Error("Clip numbers start at 1.");
    }
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    clips.push(item);
  }
  if (clips.length === 0) {
    throw new Error("Check at least one clip.");
  }
  return clips;
}

function requiredClip(body: Record<string, unknown>): number {
  const value = body.clip;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("Clip numbers start at 1.");
  }
  return value;
}

function readView(body: Record<string, unknown>): CameraView {
  return {
    pan: finiteField(body.pan, "pan"),
    tilt: finiteField(body.tilt, "tilt"),
    roll: finiteField(body.roll, "roll"),
    fov: finiteField(body.fov, "fov"),
    correction: finiteField(body.correction, "correction"),
  };
}

function finiteField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function booleanField(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  return value === true;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  sendText(
    response,
    status,
    JSON.stringify(body),
    "application/json; charset=utf-8",
  );
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string,
  type: string,
): void {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}
