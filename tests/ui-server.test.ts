import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crc32Hex } from "../src/model/signature.js";
import { parseByteRange, proxyCacheKey } from "../src/ui/media.js";
import { startUiServer, type UiServer } from "../src/ui/server.js";

function wrap(data: string): string {
  return `{"signature":"${crc32Hex(data)}","signature_method":"crc32","data":${data}}`;
}

function assetPayload(locator: string): string {
  return JSON.stringify({
    nodes: [
      { __type__: "Track", id: "track-1", clips: [{ id: "video-1" }] },
      {
        __type__: "PanoramaVideo",
        id: "video-1",
        time_range: [0, 1_000_000],
        freedom_view_id: "view-1",
        resource_asset: "asset-1",
      },
      { __type__: "Asset", id: "asset-1", locator },
      {
        __type__: "PanoramaViewData",
        id: "view-1",
        view_param: [0, 0, 0, 60, 1],
        view_offset: [0, 0, 0, 0, 0],
      },
    ],
  });
}

const data = `{"nodes":[{"__type__":"Track","id":"track-1","volume":1.0,"clips":[{"id":"video-1"},{"id":"video-2"}]},{"__type__":"PanoramaVideo","id":"video-1","time_range":[0,8200000],"freedom_view_id":"view-1"},{"__type__":"PanoramaVideo","id":"video-2","time_range":[8200000,16400000],"freedom_view_id":"view-2"},{"__type__":"PanoramaViewData","id":"view-1","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0]},{"__type__":"PanoramaViewData","id":"view-2","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0]}]}`;

describe("framing desk", () => {
  let ui: UiServer | undefined;

  afterEach(async () => {
    await ui?.close();
    ui = undefined;
  });

  it("substitutes preview orientation into the shader script", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dji-ui-shader-"));
    ui = await startUiServer({
      port: 0,
      homeRoot: root,
      projectRoot: root,
      libraryPath: path.join(root, "library.json"),
      checkStudio: false,
    });
    const response = await fetch(`${ui.url}/preview.js`);
    expect(response.status).toBe(200);
    const source = await response.text();
    expect(source).not.toContain("__YAW_DEGREES__");
    expect(source).not.toContain("__FLIP_HORIZONTAL__");
    expect(source).toContain("const yawDegrees = 0;");
    expect(source).toContain("const flipHorizontal = false;");
    expect(source).toContain("const panSign = 1;");
    new Function(source);
  });

  it("lists a project, previews without writing, then writes the free view", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dji-ui-"));
    const draftPath = path.join(
      root,
      "31",
      "nova",
      "draft.proj",
      "8",
      "draft.json",
    );
    await mkdir(path.dirname(draftPath), { recursive: true });
    await writeFile(draftPath, wrap(data));
    ui = await startUiServer({
      port: 0,
      homeRoot: root,
      projectRoot: root,
      libraryPath: path.join(root, "library.json"),
      checkStudio: false,
    });

    const page = await fetch(ui.url);
    const html = await page.text();
    const token = html.match(/FRAME_TOKEN = "([0-9a-f]+)"/)?.[1];
    expect(token).toBeTruthy();
    expect(html).toContain("Frame desk");

    const headers = {
      "content-type": "application/json",
      "x-frame-desk": token ?? "",
    };
    const projects = await fetch(`${ui.url}/api/projects`).then((response) =>
      response.json(),
    );
    expect(projects.projects[0]?.id).toBe("31");
    expect(projects.projects[0]?.clipCount).toBe(2);

    const before = await readFile(draftPath, "utf8");
    const preview = await fetch(`${ui.url}/api/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: path.join(root, "31"),
        clip: 2,
        pan: -180,
        tilt: 0,
        roll: 0,
        fov: 60,
        correction: 1,
      }),
    }).then((response) => response.json());
    expect(preview.changed).toBe(true);
    expect(preview.lines.join("\n")).toContain("Pan");
    expect(await readFile(draftPath, "utf8")).toBe(before);

    const refused = await fetch(`${ui.url}/api/write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: draftPath,
        clip: 2,
        pan: 0,
        tilt: 0,
        roll: 0,
        fov: 60,
        correction: 1,
      }),
    });
    expect(refused.status).toBe(403);

    const written = await fetch(`${ui.url}/api/write`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: draftPath,
        clip: 2,
        pan: -180,
        tilt: 0,
        roll: 0,
        fov: 60,
        correction: 1,
      }),
    });
    expect(written.status).toBe(200);
    const body = await written.json();
    expect(body.changed).toBe(true);
    expect(body.draft.clips[1]?.view.pan).toBeCloseTo(-180, 3);
    expect(body.draft.clips[0]?.timeStart).toBe(0);
    expect(body.draft.clips[0]?.timeEnd).toBe(8_200_000);
    expect(body.draft.clips[0]?.proxyReady).toBe(false);
    expect(JSON.stringify(body.draft)).not.toContain("proxyPath");
    const text = await readFile(draftPath, "utf8");
    expect(text).toContain('"volume":1.0');
    expect(text).toContain("-3.1415927410125732");

    const outside = await fetch(
      `${ui.url}/api/draft?path=${encodeURIComponent("/etc/hosts")}`,
    );
    expect(outside.status).toBe(400);
  });

  it("returns the folder chosen for the desk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dji-ui-pick-"));
    const chosen = path.join(root, "32");
    ui = await startUiServer({
      port: 0,
      homeRoot: root,
      projectRoot: root,
      libraryPath: path.join(root, "library.json"),
      checkStudio: false,
      pickFolder: async () => chosen,
    });
    const page = await fetch(ui.url);
    const token = (await page.text()).match(/FRAME_TOKEN = "([0-9a-f]+)"/)?.[1];
    const headers = {
      "content-type": "application/json",
      "x-frame-desk": token ?? "",
    };
    const studio = await fetch(`${ui.url}/api/studio`).then((response) =>
      response.json(),
    );
    expect(studio.pickFolder).toBe(true);
    const picked = await fetch(`${ui.url}/api/pick-folder`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(picked.status).toBe(200);
    expect(await picked.json()).toEqual({ path: chosen });
  });

  it("applies one preset to the checked clips and refuses a bad request", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dji-ui-apply-"));
    const draftPath = path.join(root, "31", "draft.json");
    await mkdir(path.dirname(draftPath), { recursive: true });
    const original = wrap(threeClipData());
    await writeFile(draftPath, original);
    ui = await startUiServer({
      port: 0,
      homeRoot: root,
      projectRoot: root,
      libraryPath: path.join(root, "library.json"),
      checkStudio: false,
    });
    const page = await fetch(ui.url);
    const token = (await page.text()).match(/FRAME_TOKEN = "([0-9a-f]+)"/)?.[1];
    const headers = {
      "content-type": "application/json",
      "x-frame-desk": token ?? "",
    };
    const saved = await fetch(`${ui.url}/api/presets`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "wide-left",
        pan: -180,
        tilt: 0,
        roll: 0,
        fov: 60,
        correction: 1,
      }),
    });
    expect(saved.status).toBe(200);

    const anonymous = await fetch(`${ui.url}/api/presets/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: draftPath, name: "wide-left", clips: [1] }),
    });
    expect(anonymous.status).toBe(403);

    const empty = await fetch(`${ui.url}/api/presets/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path: draftPath, name: "wide-left", clips: [] }),
    });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Check at least one clip." });

    const missing = await fetch(`${ui.url}/api/presets/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path: draftPath, name: "missing", clips: [1] }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "No preset named missing." });
    expect(await readFile(draftPath, "utf8")).toBe(original);

    const applied = await fetch(`${ui.url}/api/presets/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: draftPath,
        name: "wide-left",
        clips: [1, 3],
      }),
    });
    expect(applied.status).toBe(200);
    const body = await applied.json();
    expect(body.changed).toBe(true);
    expect(body.updated).toEqual([1, 3]);
    expect(body.unchanged).toEqual([]);
    expect(body.draft.clips[0]?.view.pan).toBeCloseTo(-180, 3);
    expect(body.draft.clips[2]?.view.pan).toBeCloseTo(-180, 3);
    expect(body.draft.clips[1]?.view.pan).toBeCloseTo((1 * 180) / Math.PI, 3);
    const text = await readFile(draftPath, "utf8");
    expect(text).toContain('"view_offset":[0.0,1.0,0.0,0.0,0.0]');
    expect(text).toContain('"kept":true');
    expect(
      (await readdir(path.dirname(draftPath))).filter((name) =>
        name.startsWith("draft.json.backup-"),
      ),
    ).toHaveLength(1);
  });

  it("reports a missing proxy without a filesystem path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dji-ui-proxy-"));
    const source = path.join(root, "media", "clip.OSV");
    const draftPath = path.join(root, "31", "draft.json");
    await mkdir(path.dirname(draftPath), { recursive: true });
    await writeFile(draftPath, wrap(assetPayload(source)));
    ui = await startUiServer({
      port: 0,
      homeRoot: root,
      projectRoot: root,
      libraryPath: path.join(root, "library.json"),
      checkStudio: false,
    });
    const opened = await fetch(
      `${ui.url}/api/draft?path=${encodeURIComponent(draftPath)}`,
    );
    expect(opened.status).toBe(200);
    const body = await opened.json();
    expect(body.clips[0]?.proxyReady).toBe(false);
    expect(body.clips[0]?.timeStart).toBe(0);
    expect(body.clips[0]?.timeEnd).toBe(1_000_000);
    const text = JSON.stringify(body);
    expect(text).not.toContain(source);
    expect(text).not.toContain("proxyPath");
  });

  it("refuses media without a token and ignores an extra query key", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dji-ui-media-"));
    const source = path.join(root, "media", "clip.OSV");
    const draftPath = path.join(root, "31", "draft.json");
    await mkdir(path.dirname(draftPath), { recursive: true });
    await writeFile(draftPath, wrap(assetPayload(source)));
    ui = await startUiServer({
      port: 0,
      homeRoot: root,
      projectRoot: root,
      libraryPath: path.join(root, "library.json"),
      checkStudio: false,
    });
    const page = await fetch(ui.url);
    const token = (await page.text()).match(/FRAME_TOKEN = "([0-9a-f]+)"/)?.[1];
    expect(token).toBeTruthy();

    const missing = new URL("/api/media", ui.url);
    missing.searchParams.set("path", draftPath);
    missing.searchParams.set("clip", "1");
    const refused = await fetch(missing);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: "Missing frame desk token.",
    });

    missing.searchParams.set("t", token ?? "");
    const absent = await fetch(missing);
    expect(absent.status).toBe(404);
    expect(await absent.json()).toEqual({
      error: "This clip has no .LRF next to its .OSV.",
    });

    const extra = new URL(missing);
    extra.searchParams.set("unused", "1");
    const again = await fetch(extra);
    expect(again.status).toBe(absent.status);
    expect(await again.json()).toEqual({
      error: "This clip has no .LRF next to its .OSV.",
    });

    const unknown = new URL(missing);
    unknown.searchParams.set("clip", "9");
    const missed = await fetch(unknown);
    expect(missed.status).toBe(400);
    expect(await missed.json()).toEqual({
      error: "Clip 9 is not in this draft. Clips: 1.",
    });
  });
});

describe("proxy cache", () => {
  it("hashes the real path, size, and truncated mtime", () => {
    expect(proxyCacheKey("a", 1, 2.9)).toBe(
      "8f0553e027e13e3868132bb8fceb7908479b3f6e27ce01eca76989274b3f5dc0",
    );
    expect(proxyCacheKey("a", 1, 2)).toBe(proxyCacheKey("a", 1, 2.9));
    expect(proxyCacheKey("b", 1, 2)).not.toBe(proxyCacheKey("a", 1, 2));
  });

  it("parses a byte range", () => {
    expect(parseByteRange(undefined, 10)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=0-0", 10)).toEqual({
      kind: "partial",
      start: 0,
      end: 0,
    });
    expect(parseByteRange("bytes=2-5", 10)).toEqual({
      kind: "partial",
      start: 2,
      end: 5,
    });
    expect(parseByteRange("bytes=8-", 10)).toEqual({
      kind: "partial",
      start: 8,
      end: 9,
    });
    expect(parseByteRange("bytes=-2", 10)).toEqual({
      kind: "partial",
      start: 8,
      end: 9,
    });
    expect(parseByteRange("bytes=0-99", 10)).toEqual({
      kind: "partial",
      start: 0,
      end: 9,
    });
    expect(parseByteRange("bytes=20-30", 10)).toEqual({
      kind: "unsatisfiable",
    });
  });
});

function threeClipData(): string {
  return `{"nodes":[{"__type__":"Track","id":"track-1","volume":1.0,"clips":[{"id":"video-1"},{"id":"video-2"},{"id":"video-3"}]},{"__type__":"PanoramaVideo","id":"video-1","time_range":[0,1000],"freedom_view_id":"view-1"},{"__type__":"PanoramaVideo","id":"video-2","time_range":[1000,2000],"freedom_view_id":"view-2"},{"__type__":"PanoramaVideo","id":"video-3","time_range":[2000,3000],"freedom_view_id":"view-3"},{"__type__":"PanoramaViewData","id":"view-1","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0]},{"__type__":"PanoramaViewData","id":"view-2","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,1.0,0.0,0.0,0.0],"kept":true},{"__type__":"PanoramaViewData","id":"view-3","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0]}]}`;
}
