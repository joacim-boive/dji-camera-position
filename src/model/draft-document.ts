import { randomBytes } from "node:crypto";
import {
  copyFile,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { isPlainObject, parseJsonText } from "../json.js";
import {
  formatViewTuple,
  offsetWithPatch,
  tuplesEqual,
  viewFromAbsolute,
  viewFromOffset,
  viewTuple,
  type CameraView,
  type CameraViewPatch,
  type ViewTuple,
} from "./camera-view.js";
import { applyEdits, findObjectById, keyValueSpan } from "./json-span.js";
import {
  crc32Hex,
  dataValueSpan,
  inspectSignature,
  readLeadingSignature,
} from "./signature.js";

export type ClipKeyframe = {
  timeUs: number | undefined;
  interpolation: number;
  view: CameraView;
};

export type ClipView = {
  index: number;
  videoId: string;
  viewId: string;
  timeStart: number;
  timeEnd: number;
  hasDirectionLockView: boolean;
  view: CameraView;
  viewParam: ViewTuple;
  viewOffset: ViewTuple;
  keyframes: ClipKeyframe[];
};

export type DraftViewReport = {
  draftPath: string;
  signature: string;
  signatureMethod: string;
  signatureMatches: boolean;
  clips: ClipView[];
};

export type WriteResult = {
  changed: boolean;
  backupPath?: string;
  before: CameraView;
  after: CameraView;
};

type VideoNode = {
  id: string;
  freedomViewId: string;
  keyframesId: string | undefined;
  hasDirectionLockView: boolean;
  timeStart: number;
  timeEnd: number;
};

export async function resolveDraftFile(target: string): Promise<string> {
  const info = await stat(target);
  if (info.isFile()) {
    if (path.basename(target) !== "draft.json") {
      throw new Error("Pass a project directory or a draft.json file.");
    }
    return target;
  }
  if (!info.isDirectory()) {
    throw new Error("Pass a project directory or a draft.json file.");
  }
  const found: string[] = [];
  await collectDrafts(target, 0, found);
  if (found.length === 0) {
    throw new Error("No draft.json in that directory.");
  }
  if (found.length > 1) {
    throw new Error(
      `Found ${found.length} draft.json files. Pass one draft.json path.`,
    );
  }
  const only = found[0];
  if (only === undefined) {
    throw new Error("No draft.json in that directory.");
  }
  return only;
}

export async function readDraftViews(
  draftPath: string,
): Promise<DraftViewReport> {
  const text = await readFile(draftPath, "utf8");
  return parseDraftViews(draftPath, text);
}

export function parseDraftViews(
  draftPath: string,
  text: string,
): DraftViewReport {
  const source = stripBom(text);
  const root = parseJsonText(source);
  if (!isPlainObject(root)) {
    throw new Error("Draft JSON is not an object.");
  }
  const data = root.data;
  if (!isPlainObject(data)) {
    throw new Error("Draft data is not an object.");
  }
  if (!Array.isArray(data.nodes)) {
    throw new Error("Draft data.nodes is not an array.");
  }
  const nodes: Record<string, unknown>[] = [];
  for (const node of data.nodes) {
    if (!isPlainObject(node)) {
      throw new Error("A draft node is not an object.");
    }
    nodes.push(node);
  }
  const signature = inspectSignature(
    source,
    root.signature,
    root.signature_method,
  );
  return {
    draftPath,
    signature: signature.hex,
    signatureMethod: signature.method,
    signatureMatches: signature.matches,
    clips: readClips(nodes),
  };
}

export function clipAt(clips: readonly ClipView[], index: number): ClipView {
  const clip = clips.find((item) => item.index === index);
  if (clip === undefined) {
    const available = clips.map((item) => String(item.index)).join(", ");
    throw new Error(`Clip ${index} is not in this draft. Clips: ${available}.`);
  }
  return clip;
}

export async function writeClipView(
  draftPath: string,
  clipIndex: number,
  patch: CameraViewPatch,
): Promise<WriteResult> {
  const original = stripBom(await readFile(draftPath, "utf8"));
  const report = parseDraftViews(draftPath, original);
  if (report.signatureMethod !== "crc32" || !report.signatureMatches) {
    throw new Error(
      "The crc32 signature does not match this draft. Refusing to write.",
    );
  }
  const clip = clipAt(report.clips, clipIndex);
  const nextOffset = offsetWithPatch(clip.viewParam, clip.viewOffset, patch);
  const after = viewFromOffset(clip.viewParam, nextOffset);
  if (tuplesEqual(clip.viewOffset, nextOffset)) {
    return { changed: false, before: clip.view, after };
  }

  const objectSpan = findObjectById(original, clip.viewId);
  const offsetSpan = keyValueSpan(original, objectSpan, "view_offset");
  const withOffset = applyEdits(original, [
    { ...offsetSpan, next: formatViewTuple(nextOffset) },
  ]);
  const data = dataValueSpan(withOffset);
  const nextSignature = crc32Hex(withOffset.slice(data.start, data.end));
  const signature = readLeadingSignature(withOffset);
  const nextText = applyEdits(withOffset, [
    { start: signature.start, end: signature.end, next: nextSignature },
  ]);
  assertRewritten(original, nextText, clip.viewId, nextOffset);

  const tempPath = `${draftPath}.tmp-${randomBytes(4).toString("hex")}`;
  const backupPath = `${draftPath}.backup-${backupStamp()}-${randomBytes(2).toString("hex")}`;
  try {
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(nextText, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const written = await readFile(tempPath, "utf8");
    if (written !== nextText) {
      throw new Error("Temporary draft did not match the rewrite.");
    }
    await copyFile(draftPath, backupPath);
    try {
      await rename(tempPath, draftPath);
    } catch (error) {
      await unlink(backupPath).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  return { changed: true, backupPath, before: clip.view, after };
}

async function collectDrafts(
  directory: string,
  depth: number,
  found: string[],
): Promise<void> {
  if (depth > 8 || found.length > 1) {
    return;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectDrafts(fullPath, depth + 1, found);
      continue;
    }
    if (entry.isFile() && entry.name === "draft.json") {
      found.push(fullPath);
    }
  }
}

function readClips(nodes: readonly Record<string, unknown>[]): ClipView[] {
  const byId = new Map<string, Record<string, unknown>>();
  const videos: VideoNode[] = [];
  for (const node of nodes) {
    const id = typeof node.id === "string" ? node.id : undefined;
    if (id !== undefined) {
      if (byId.has(id)) {
        throw new Error(`Node id ${id} appears more than once.`);
      }
      byId.set(id, node);
    }
    if (node.__type__ === "PanoramaVideo") {
      videos.push(readVideo(node));
    }
  }
  if (videos.length === 0) {
    throw new Error("This draft has no PanoramaVideo clips.");
  }
  return videoOrder(nodes, videos).map((video, index) => {
    const viewNode = byId.get(video.freedomViewId);
    if (viewNode === undefined || viewNode.__type__ !== "PanoramaViewData") {
      throw new Error(
        `Clip ${video.id} freedom view ${video.freedomViewId} is missing.`,
      );
    }
    const viewParam = viewTuple(readArray(viewNode.view_param), "view_param");
    const viewOffset = viewTuple(
      readArray(viewNode.view_offset),
      "view_offset",
    );
    const keyframes =
      video.keyframesId === undefined
        ? []
        : readKeyframeNode(byId.get(video.keyframesId), video.keyframesId);
    return {
      index: index + 1,
      videoId: video.id,
      viewId: video.freedomViewId,
      timeStart: video.timeStart,
      timeEnd: video.timeEnd,
      hasDirectionLockView: video.hasDirectionLockView,
      view: viewFromOffset(viewParam, viewOffset),
      viewParam,
      viewOffset,
      keyframes,
    };
  });
}

function readVideo(node: Record<string, unknown>): VideoNode {
  const id = requiredString(node, "id", "PanoramaVideo");
  const freedomViewId = requiredString(
    node,
    "freedom_view_id",
    `PanoramaVideo ${id}`,
  );
  const range = readArray(node.time_range);
  const start = range[0];
  const end = range[1];
  if (
    range.length !== 2 ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    throw new Error(`PanoramaVideo ${id} time_range must be two numbers.`);
  }
  return {
    id,
    freedomViewId,
    keyframesId: optionalString(node, "freedom_kfs_id"),
    hasDirectionLockView:
      optionalString(node, "dir_lock_view_id") !== undefined,
    timeStart: start,
    timeEnd: end,
  };
}

function videoOrder(
  nodes: readonly Record<string, unknown>[],
  videos: readonly VideoNode[],
): VideoNode[] {
  const byId = new Map(videos.map((video) => [video.id, video]));
  let best: VideoNode[] = [];
  for (const node of nodes) {
    if (node.__type__ !== "Track" || !Array.isArray(node.clips)) {
      continue;
    }
    const ordered: VideoNode[] = [];
    for (const clip of node.clips) {
      if (!isPlainObject(clip) || typeof clip.id !== "string") {
        continue;
      }
      const video = byId.get(clip.id);
      if (video !== undefined) {
        ordered.push(video);
      }
    }
    if (ordered.length > best.length) {
      best = ordered;
    }
  }
  const seen = new Set(best.map((video) => video.id));
  const rest = videos
    .filter((video) => !seen.has(video.id))
    .sort(
      (left, right) =>
        left.timeStart - right.timeStart || left.id.localeCompare(right.id),
    );
  if (best.length === 0) {
    return [...rest];
  }
  return [...best, ...rest];
}

function readKeyframeNode(
  node: Record<string, unknown> | undefined,
  id: string,
): ClipKeyframe[] {
  if (node === undefined) {
    throw new Error(`Keyframe node ${id} is missing.`);
  }
  if (!Object.hasOwn(node, "keyframes")) {
    return [];
  }
  const list = node.keyframes;
  if (!Array.isArray(list)) {
    throw new Error(`Keyframe node ${id} keyframes is not an array.`);
  }
  return list.map((item, index) => {
    const label = `Keyframe node ${id} item ${index + 1}`;
    if (!isPlainObject(item)) {
      throw new Error(`${label} is not an object.`);
    }
    if (typeof item.e !== "number" || !Number.isFinite(item.e)) {
      throw new Error(`${label} has no numeric e value.`);
    }
    if (
      Object.hasOwn(item, "p") &&
      (typeof item.p !== "number" || !Number.isFinite(item.p))
    ) {
      throw new Error(`${label} has no numeric p time.`);
    }
    return {
      timeUs: typeof item.p === "number" ? item.p : undefined,
      interpolation: item.e,
      view: viewFromAbsolute(viewTuple(readArray(item.v), `${label} v`)),
    };
  });
}

function assertRewritten(
  beforeText: string,
  afterText: string,
  viewId: string,
  offset: ViewTuple,
): void {
  const before = parseJsonText(beforeText);
  const after = parseJsonText(afterText);
  assertPreserved(before, after, viewId, "");
  const report = parseDraftViews("rewritten", afterText);
  if (!report.signatureMatches) {
    throw new Error("Rewritten signature does not match the data payload.");
  }
  const clip = report.clips.find((item) => item.viewId === viewId);
  if (clip === undefined || !tuplesEqual(clip.viewOffset, offset)) {
    throw new Error("Rewritten view_offset does not match the requested view.");
  }
}

function assertPreserved(
  before: unknown,
  after: unknown,
  viewId: string,
  location: string,
): void {
  if (location === "signature") {
    return;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (
      !Array.isArray(before) ||
      !Array.isArray(after) ||
      before.length !== after.length
    ) {
      throw new Error(`Draft structure changed at ${location || "root"}.`);
    }
    for (let index = 0; index < before.length; index += 1) {
      const left = before[index];
      const right = after[index];
      if (left === undefined || right === undefined) {
        throw new Error(`Draft structure changed at ${location}[${index}].`);
      }
      assertPreserved(left, right, viewId, `${location}[${index}]`);
    }
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);
    if (beforeKeys.join("\0") !== afterKeys.join("\0")) {
      throw new Error(`Draft fields changed at ${location || "root"}.`);
    }
    const isTarget =
      before.__type__ === "PanoramaViewData" && before.id === viewId;
    for (const key of beforeKeys) {
      if (isTarget && key === "view_offset") {
        continue;
      }
      assertPreserved(
        before[key],
        after[key],
        viewId,
        location.length === 0 ? key : `${location}.${key}`,
      );
    }
    return;
  }
  if (!sameLeaf(before, after)) {
    throw new Error(`Draft value changed at ${location || "root"}.`);
  }
}

function sameLeaf(before: unknown, after: unknown): boolean {
  return before === after || (Number.isNaN(before) && Number.isNaN(after));
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredString(
  node: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = node[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is missing ${key}.`);
  }
  return value;
}

function optionalString(
  node: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(node, key)) {
    return undefined;
  }
  const value = node[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is not a node id.`);
  }
  return value;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function backupStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
