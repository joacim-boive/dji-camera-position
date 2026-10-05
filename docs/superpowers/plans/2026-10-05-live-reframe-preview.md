# Live reframe preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a 16:9 monitor of the current clip’s `.LRF` proxy, aimed with the form’s pan, tilt, roll, FOV, and correction, without decoding the `.OSV` or writing the draft until Write.

**Architecture:** `src/model/reframe.ts` owns the projection. A WebGL shader in `src/ui/public/preview.js` is a line-for-line port of that math and receives calibration by the same placeholder substitution the page already uses for its token. The desk resolves each clip’s `.LRF` from the Asset locator, and `GET /api/media` remuxes that file with ffmpeg into a byte-ranged MP4. The existing `#monitor` element stays the editor shell. The picture is a new `#picture` block above the spirit level, inside the glass, which already scrolls.

**Tech Stack:** TypeScript (NodeNext, types not interfaces), Node `http`, Vitest, Electron, WebGL 1, ffmpeg on `PATH`.

## Global Constraints

- The `.OSV` is never decoded. The picture plays only the remuxed `.LRF`.
- The draft changes only when Write is pressed. Previewing does not write `draft.json`.
- The picture follows the form’s static view. Keyframes are not animated. The existing note, that Write updates the static view only, stays.
- The monitor has no audio.
- The Electron window is not resized (`src/app/main.ts` stays as it is). The glass already scrolls (`overflow: auto` on `.glass`). Do not change the window size to fit the picture.
- The frame is 16:9. Other export aspects are out of scope.
- The FOV field is the vertical angle of a rectilinear lens. The preview clamps that angle to the open interval `(0°, 179°]` before the tangent. The form and Write still use the typed value.
- `nx` runs from `-16/9` on the left to `16/9` on the right. `ny` runs from `-1` at the bottom to `1` at the top.
- Aim order is roll, then tilt, then pan. With every sign at `+1` and zero offsets: positive pan aims the center toward `+X`, positive tilt aims the center toward `+Y`, and positive roll tips the horizon counterclockwise (a pixel right of center looks downward).
- Studio Zoom, in degrees, is the rectilinear horizontal angle of this 16:9 frame multiplied by `max(0, 1 + correction)`, rounded to one decimal: FOV 60 / correction 0 → 91.5, 60 / 1 → 183.0, 20 / 0 → 34.8, 20 / 1 → 69.6.
- In the tests, “vertical edge” means the top or bottom edge (half the vertical FOV). “Horizontal edge” means the left or right edge (half the Zoom angle). That matches FOV as the vertical angle and Zoom as the horizontal angle.
- `previewOrientation` defaults are zero offsets, `flipHorizontal: false`, and all signs `1`.
- `localStorage` key `frame-desk-preview`. The value `"hidden"` hides the picture. A missing key, or any other value, shows it.
- Sentences, exact: `This clip has no .LRF next to its .OSV.` / `ffmpeg is required to prepare the preview.` / `The preview proxy could not be prepared.` / `This browser cannot show the preview.`
- A draft outside the allowed folder keeps `That draft is outside the allowed folder.` An unknown clip keeps `Clip <n> is not in this draft. Clips: <list>.`
- `/api/media` is authorized when `t` equals the page token or `x-frame-desk` does. Otherwise `403` with `Missing frame desk token.`
- The media handler loads the proxy from the clip. It does not accept a media path from the query. The filesystem path is not sent to the browser.
- Cache file: `os.tmpdir()/frame-desk-proxies/<sha256>.mp4`. Hash input: UTF-8 `realPath + "\0" + size + "\0" + mtimeMs`, with `mtimeMs` truncated toward zero. Remux writes `<hash>.mp4.part`, then renames. Concurrent requests for the same hash share one ffmpeg run.
- Missing proxy is `404`. ffmpeg missing or a failed remux is `400`. Spawn `ENOENT` is the missing-ffmpeg sentence. Any other failed remux deletes the `.part` file and uses the other sentence.
- When `proxyReady` is false, the client shows the missing-proxy sentence and does not request media.
- Clip numbers start at 1. Extra query keys are ignored.
- Do not add a packaged server, a bundler, audio, keyframe playback, or an export.

---

### Task 1: Reframe math

**Files:**

- Create: `src/model/reframe.ts`
- Test: `tests/reframe.test.ts`

**Interfaces:**

- Consumes: `CameraView` from `src/model/camera-view.ts` (`pan`, `tilt`, `roll`, `fov`, `correction`).
- Produces:
  - `previewOrientation` — the calibration record below.
  - `clampPreviewFov(fovDegrees: number): number` — result is in `(0, 179]`. Floor is `1e-4`.
  - `studioZoomDegrees(fovDegrees: number, correction: number): number` — unrounded degrees.
  - `reframedRay(sensor: { nx: number; ny: number }, view: CameraView, orientation?: PreviewOrientation): { x: number; y: number; z: number }`
  - `equirectangularSample(ray: { x: number; y: number; z: number }, flipHorizontal: boolean): { u: number; v: number }`
  - `type PreviewOrientation = { yawDegrees: number; pitchDegrees: number; rollDegrees: number; flipHorizontal: boolean; panSign: 1 | -1; tiltSign: 1 | -1; rollSign: 1 | -1 }`

- [ ] **Step 1: Write the failing test**

Create `tests/reframe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CameraView } from "../src/model/camera-view.js";
import {
  equirectangularSample,
  reframedRay,
  studioZoomDegrees,
} from "../src/model/reframe.js";

const ahead: CameraView = {
  pan: 0,
  tilt: 0,
  roll: 0,
  fov: 60,
  correction: 0,
};

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

function angleFromForward(ray: { x: number; y: number; z: number }): number {
  const length = Math.hypot(ray.x, ray.y, ray.z);
  return (Math.acos(ray.z / length) * 180) / Math.PI;
}

describe("reframe", () => {
  it("matches Studio zoom after rounding to one decimal", () => {
    expect(oneDecimal(studioZoomDegrees(60, 0))).toBe("91.5");
    expect(oneDecimal(studioZoomDegrees(60, 1))).toBe("183.0");
    expect(oneDecimal(studioZoomDegrees(20, 0))).toBe("34.8");
    expect(oneDecimal(studioZoomDegrees(20, 1))).toBe("69.6");
  });

  it("looks straight ahead from the center at zero angles", () => {
    expect(reframedRay({ nx: 0, ny: 0 }, ahead)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("puts the middle of a vertical edge at half the FOV", () => {
    const ray = reframedRay({ nx: 0, ny: 1 }, ahead);
    expect(angleFromForward(ray)).toBeCloseTo(30, 6);
    expect(ray.y).toBeGreaterThan(0);
    expect(ray.x).toBeCloseTo(0, 6);
  });

  it("puts the middle of a horizontal edge at half the zoom angle", () => {
    for (const correction of [0, 1]) {
      const view = { ...ahead, correction };
      const ray = reframedRay({ nx: 16 / 9, ny: 0 }, view);
      expect(angleFromForward(ray)).toBeCloseTo(
        studioZoomDegrees(60, correction) / 2,
        6,
      );
      expect(ray.x).toBeGreaterThan(0);
    }
  });

  it("aims a small positive pan, tilt, and roll", () => {
    const pan = reframedRay({ nx: 0, ny: 0 }, { ...ahead, pan: 2 });
    expect(pan.x).toBeGreaterThan(0);
    expect(pan.y).toBeCloseTo(0, 6);

    const tilt = reframedRay({ nx: 0, ny: 0 }, { ...ahead, tilt: 2 });
    expect(tilt.y).toBeGreaterThan(0);
    expect(tilt.x).toBeCloseTo(0, 6);

    const level = reframedRay({ nx: 0.2, ny: 0 }, ahead);
    const rolled = reframedRay({ nx: 0.2, ny: 0 }, { ...ahead, roll: 8 });
    expect(rolled.y).toBeLessThan(level.y);
  });

  it("maps forward to the texture center and straight up to v = 0", () => {
    expect(equirectangularSample({ x: 0, y: 0, z: 1 }, false)).toEqual({
      u: 0.5,
      v: 0.5,
    });
    expect(equirectangularSample({ x: 0, y: 1, z: 0 }, false).v).toBeCloseTo(
      0,
      6,
    );
    const right = equirectangularSample({ x: 1, y: 0, z: 0 }, false);
    const flipped = equirectangularSample({ x: 1, y: 0, z: 0 }, true);
    expect(flipped.u).toBeCloseTo(1 - right.u, 6);
  });

  it("clamps the preview field of view to (0°, 179°]", () => {
    const capped = reframedRay({ nx: 16 / 9, ny: 0 }, { ...ahead, fov: 179 });
    const wider = reframedRay({ nx: 16 / 9, ny: 0 }, { ...ahead, fov: 180 });
    expect(angleFromForward(wider)).toBeCloseTo(angleFromForward(capped), 5);
    const shut = reframedRay({ nx: 16 / 9, ny: 0 }, { ...ahead, fov: 0 });
    expect(Number.isFinite(shut.x + shut.y + shut.z)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/reframe.test.ts`

Expected: FAIL because `src/model/reframe.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/model/reframe.ts`:

```ts
import type { CameraView } from "./camera-view.js";

export type PreviewOrientation = {
  yawDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
  flipHorizontal: boolean;
  panSign: 1 | -1;
  tiltSign: 1 | -1;
  rollSign: 1 | -1;
};

export type SensorPoint = {
  nx: number;
  ny: number;
};

export type Ray = {
  x: number;
  y: number;
  z: number;
};

export type EquirectSample = {
  u: number;
  v: number;
};

const previewFovFloor = 1e-4;

export const previewOrientation: PreviewOrientation = {
  yawDegrees: 0,
  pitchDegrees: 0,
  rollDegrees: 0,
  flipHorizontal: false,
  panSign: 1,
  tiltSign: 1,
  rollSign: 1,
};

export function clampPreviewFov(fovDegrees: number): number {
  if (!(fovDegrees > previewFovFloor)) {
    return previewFovFloor;
  }
  if (fovDegrees > 179) {
    return 179;
  }
  return fovDegrees;
}

export function studioZoomDegrees(
  fovDegrees: number,
  correction: number,
): number {
  const half = (clampPreviewFov(fovDegrees) * Math.PI) / 360;
  const horizontal = (2 * Math.atan((16 / 9) * Math.tan(half)) * 180) / Math.PI;
  return horizontal * Math.max(0, 1 + correction);
}

export function reframedRay(
  sensor: SensorPoint,
  view: CameraView,
  orientation: PreviewOrientation = previewOrientation,
): Ray {
  const aimedPan = orientation.panSign * view.pan + orientation.yawDegrees;
  const aimedTilt = orientation.tiltSign * view.tilt + orientation.pitchDegrees;
  const aimedRoll = orientation.rollSign * view.roll + orientation.rollDegrees;
  const lens = lensRay(sensor, view.fov, view.correction);
  const rolled = rotateZ(lens, -aimedRoll);
  const tilted = rotateX(rolled, -aimedTilt);
  return rotateY(tilted, aimedPan);
}

export function equirectangularSample(
  ray: Ray,
  flipHorizontal: boolean,
): EquirectSample {
  const length = Math.hypot(ray.x, ray.y, ray.z);
  const x = ray.x / length;
  const y = ray.y / length;
  const z = ray.z / length;
  const longitude = Math.atan2(x, z);
  const latitude = Math.asin(Math.min(1, Math.max(-1, y)));
  const u = 0.5 + longitude / (2 * Math.PI);
  return {
    u: flipHorizontal ? 1 - u : u,
    v: 0.5 - latitude / Math.PI,
  };
}

function lensRay(
  sensor: SensorPoint,
  fovDegrees: number,
  correction: number,
): Ray {
  const half = (clampPreviewFov(fovDegrees) * Math.PI) / 360;
  const scale = Math.tan(half);
  const point = { x: sensor.nx * scale, y: sensor.ny * scale };
  const radius = Math.hypot(point.x, point.y);
  if (radius === 0) {
    return { x: 0, y: 0, z: 1 };
  }
  const theta = Math.min(
    Math.PI,
    Math.max(0, 1 + correction) * Math.atan(radius),
  );
  const spread = Math.sin(theta) / radius;
  return {
    x: point.x * spread,
    y: point.y * spread,
    z: Math.cos(theta),
  };
}

function rotateX(ray: Ray, degrees: number): Ray {
  const { cos, sin } = turn(degrees);
  return {
    x: ray.x,
    y: ray.y * cos - ray.z * sin,
    z: ray.y * sin + ray.z * cos,
  };
}

function rotateY(ray: Ray, degrees: number): Ray {
  const { cos, sin } = turn(degrees);
  return {
    x: ray.x * cos + ray.z * sin,
    y: ray.y,
    z: -ray.x * sin + ray.z * cos,
  };
}

function rotateZ(ray: Ray, degrees: number): Ray {
  const { cos, sin } = turn(degrees);
  return {
    x: ray.x * cos - ray.y * sin,
    y: ray.x * sin + ray.y * cos,
    z: ray.z,
  };
}

function turn(degrees: number): { cos: number; sin: number } {
  const radians = (degrees * Math.PI) / 180;
  return { cos: Math.cos(radians), sin: Math.sin(radians) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/reframe.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/model/reframe.ts tests/reframe.test.ts
git commit -m "$(cat <<'EOF'
Add the rectilinear reframe used by the live preview.

Studio's zoom readout and the pan, tilt, and roll aims need one place to live before the shader copies them.
EOF
)"
```

---

### Task 2: Proxy path and draft fields

**Files:**

- Create: `src/model/proxy.ts`
- Modify: `src/model/draft-document.ts` (`ClipView`, `readClips`)
- Modify: `src/ui/server.ts` (`draftJson`)
- Modify: `tests/ui-server.test.ts` (existing write assertion, plus a new test)

**Interfaces:**

- Consumes: a parsed draft node map and `draftPath`.
- Produces:
  - `lrfBesideSource(draftPath: string, video: Record<string, unknown> | undefined, nodesById: ReadonlyMap<string, Record<string, unknown>>): string | undefined`
  - `lrfIsPresent(filePath: string | undefined): Promise<boolean>`
  - `ClipView.proxyPath: string | undefined` — server-side only, never JSON.
  - Draft JSON clip fields `timeStart: number`, `timeEnd: number`, `proxyReady: boolean`.

- [ ] **Step 1: Write the failing test**

In `tests/ui-server.test.ts`, extend the write assertion in the first test, after `expect(body.draft.clips[1]?.view.pan).toBeCloseTo(-180, 3);`:

```ts
expect(body.draft.clips[0]?.timeStart).toBe(0);
expect(body.draft.clips[0]?.timeEnd).toBe(8_200_000);
expect(body.draft.clips[0]?.proxyReady).toBe(false);
expect(JSON.stringify(body.draft)).not.toContain("proxyPath");
```

Append this test. `wrap` is already in the file.

```ts
it("reports a missing proxy without a filesystem path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dji-ui-proxy-"));
  const source = path.join(root, "media", "clip.OSV");
  const draftPath = path.join(root, "31", "draft.json");
  await mkdir(path.dirname(draftPath), { recursive: true });
  const payload = JSON.stringify({
    nodes: [
      {
        __type__: "Track",
        id: "track-1",
        clips: [{ id: "video-1" }],
      },
      {
        __type__: "PanoramaVideo",
        id: "video-1",
        time_range: [1_000_000, 5_000_000],
        freedom_view_id: "view-1",
        resource_asset: "asset-1",
      },
      { __type__: "Asset", id: "asset-1", locator: source },
      {
        __type__: "PanoramaViewData",
        id: "view-1",
        view_param: [0, 0, 0, 60, 1],
        view_offset: [0, 0, 0, 0, 0],
      },
    ],
  });
  await writeFile(draftPath, wrap(payload));
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
  expect(body.clips[0]?.timeStart).toBe(1_000_000);
  expect(body.clips[0]?.timeEnd).toBe(5_000_000);
  const text = JSON.stringify(body);
  expect(text).not.toContain(source);
  expect(text).not.toContain("proxyPath");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/ui-server.test.ts`

Expected: FAIL because `timeStart` and `proxyReady` are undefined.

- [ ] **Step 3: Resolve the `.LRF` and add the JSON fields**

Create `src/model/proxy.ts`:

```ts
import { stat } from "node:fs/promises";
import path from "node:path";

export function lrfBesideSource(
  draftPath: string,
  video: Record<string, unknown> | undefined,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
): string | undefined {
  if (video === undefined) {
    return undefined;
  }
  const assetId = video.resource_asset;
  if (typeof assetId !== "string" || assetId.length === 0) {
    return undefined;
  }
  const asset = nodesById.get(assetId);
  if (asset === undefined || asset.__type__ !== "Asset") {
    return undefined;
  }
  const locator = asset.locator;
  if (typeof locator !== "string" || locator.length === 0) {
    return undefined;
  }
  const source = path.isAbsolute(locator)
    ? locator
    : path.resolve(path.dirname(draftPath), locator);
  const extension = path.extname(source);
  const base = path.basename(source, extension);
  return path.join(path.dirname(source), `${base}.LRF`);
}

export async function lrfIsPresent(
  filePath: string | undefined,
): Promise<boolean> {
  if (filePath === undefined) {
    return false;
  }
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}
```

In `src/model/draft-document.ts`:

- Import `lrfBesideSource` from `./proxy.js`.
- Add `proxyPath: string | undefined` to `ClipView`.
- Change `clips: readClips(nodes)` to `clips: readClips(draftPath, nodes)`.
- Change `function readClips(nodes: ...)` to `function readClips(draftPath: string, nodes: ...)`.
- In the object returned for each clip, add:

```ts
      proxyPath: lrfBesideSource(draftPath, byId.get(video.id), byId),
```

In `src/ui/server.ts`:

- Import `lrfIsPresent` from `../model/proxy.js`.
- Make `draftJson` `async`, and `await` it at every call site (`/api/draft`, `/api/write`, `/api/presets/apply`).
- Add `timeStart`, `timeEnd`, and `proxyReady` to the clip type and the mapped object:

```ts
      timeStart: clip.timeStart,
      timeEnd: clip.timeEnd,
      proxyReady: await lrfIsPresent(clip.proxyPath),
```

Do not put `proxyPath` in the JSON.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run tests/ui-server.test.ts tests/draft-document.test.ts`

Expected: PASS. Drafts with no Asset node still open, and `proxyReady` is false.

- [ ] **Step 5: Commit**

```bash
git add src/model/proxy.ts src/model/draft-document.ts src/ui/server.ts tests/ui-server.test.ts
git commit -m "$(cat <<'EOF'
Report each clip's range and whether its .LRF proxy exists.

The preview can skip a missing proxy without putting the filesystem path on the page.
EOF
)"
```

---

### Task 3: Serve the remuxed proxy

**Files:**

- Create: `src/ui/media.ts`
- Modify: `src/ui/server.ts` (`GET /api/media`)
- Modify: `tests/ui-server.test.ts`

**Interfaces:**

- Consumes: `ClipView.proxyPath`, `readAllowedDraft`, `clipAt`.
- Produces:
  - `missingProxySentence`, `missingFfmpegSentence`, `remuxFailedSentence`
  - `proxyCacheKey(realPath: string, size: number, mtimeMs: number): string`
  - `parseByteRange(header: string | undefined, size: number): { kind: "full" } | { kind: "partial"; start: number; end: number } | { kind: "unsatisfiable" }`
  - `preparedProxy(realPath: string, size: number, mtimeMs: number): Promise<string>` — cache mp4 path
  - `GET /api/media?path=<draft>&clip=<index>&t=<token>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui-server.test.ts`:

```ts
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
```

Add this helper beside `wrap` in the same file:

```ts
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
```

Use `wrap(assetPayload(source))` in the Task 2 test too if that payload was inlined there. One helper is enough.

Add `tests/media-cache.test.ts` is not a new suite. Put the cache-key and range checks in `tests/ui-server.test.ts` by importing them:

```ts
import { parseByteRange, proxyCacheKey } from "../src/ui/media.js";

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
```

The hash above is SHA-256 of the UTF-8 string `a\0` + `1\0` + `2`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/ui-server.test.ts`

Expected: FAIL. `/api/media` is 404 and `proxyCacheKey` is not exported.

- [ ] **Step 3: Implement the media route**

Create `src/ui/media.ts`:

```ts
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
  job.finally(() => {
    jobs.delete(hash);
  });
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
    response.on("close", resolve);
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
```

In `src/ui/server.ts`, import `realpath` and `stat` from `node:fs/promises` and:

```ts
import {
  missingProxySentence,
  preparedProxy,
  remuxSentence,
  sendVideo,
} from "./media.js";
```

Inside `handleRequest`, before the generic 404 of the API block, handle the route. Auth happens before the draft is read:

```ts
if (request.method === "GET" && url.pathname === "/api/media") {
  const header = request.headers["x-frame-desk"];
  const authorized =
    url.searchParams.get("t") === context.token ||
    (typeof header === "string" && header === context.token);
  if (!authorized) {
    sendJson(response, 403, { error: "Missing frame desk token." });
    return;
  }
  const report = await readAllowedDraft(
    url.searchParams.get("path") ?? "",
    context.homeRoot,
  );
  const clip = clipAt(report.clips, clipQuery(url));
  const realPath = await resolvedLrf(clip.proxyPath);
  if (realPath === undefined) {
    sendJson(response, 404, { error: missingProxySentence });
    return;
  }
  try {
    const info = await stat(realPath);
    const file = await preparedProxy(realPath, info.size, info.mtimeMs);
    await sendVideo(request, response, file);
  } catch (error) {
    sendJson(response, 400, { error: remuxSentence(error) });
  }
  return;
}
```

```ts
function clipQuery(url: URL): number {
  const value = Number(url.searchParams.get("clip"));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Clip numbers start at 1.");
  }
  return value;
}

async function resolvedLrf(
  filePath: string | undefined,
): Promise<string | undefined> {
  if (filePath === undefined) {
    return undefined;
  }
  try {
    const realPath = await realpath(filePath);
    if (!realPath.toLowerCase().endsWith(".lrf")) {
      return undefined;
    }
    return realPath;
  } catch {
    return undefined;
  }
}
```

A missing proxy returns 404 from this branch. It must not fall through to the `catch` that sends 400. `clipAt` still throws, and that throw still becomes 400 with the existing clip sentence.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run tests/ui-server.test.ts && pnpm typecheck`

Expected: PASS. Typecheck is clean. Preparing a real `.LRF` stays a manual check.

- [ ] **Step 5: Commit**

```bash
git add src/ui/media.ts src/ui/server.ts tests/ui-server.test.ts
git commit -m "$(cat <<'EOF'
Serve a clip's .LRF as a cached, byte-ranged preview MP4.

The video element cannot send the desk header, so the same page token is accepted on the query string.
EOF
)"
```

---

### Task 4: Preview shader

**Files:**

- Create: `src/ui/public/preview.js`
- Modify: `src/ui/server.ts` (serve `/preview.js` with substitutions)
- Modify: `tests/ui-server.test.ts`

**Interfaces:**

- Consumes: `previewOrientation` from `src/model/reframe.ts`.
- Produces: `window.FramePreview.mount(elements)`, `.setVisible(visible: boolean)`, `.showClip(draftPath: string, clip: { index, timeStart, timeEnd, proxyReady })`, `.setView(view: { pan, tilt, roll, fov, correction } | null)`.
- Placeholders in `preview.js`: `__YAW_DEGREES__`, `__PITCH_DEGREES__`, `__ROLL_DEGREES__`, `__FLIP_HORIZONTAL__`, `__PAN_SIGN__`, `__TILT_SIGN__`, `__ROLL_SIGN__`.

- [ ] **Step 1: Write the failing test**

Append to the first framing-desk test, or as its own test that only fetches the script:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/ui-server.test.ts -t "substitutes preview"`

Expected: FAIL with status 404.

- [ ] **Step 3: Serve the substituted script and add the shader**

In `handleRequest`, next to the `app.js` branch, serve `preview.js` through substitution. Do not add it to the raw `app.css` / `app.js` branch.

```ts
if (request.method === "GET" && url.pathname === "/preview.js") {
  const source = await readFile(
    path.join(context.publicDir, "preview.js"),
    "utf8",
  );
  sendText(
    response,
    200,
    substitutePreview(source),
    "text/javascript; charset=utf-8",
  );
  return;
}
```

```ts
import { previewOrientation } from "../model/reframe.js";

function substitutePreview(source: string): string {
  const orientation = previewOrientation;
  return source
    .replaceAll("__YAW_DEGREES__", String(orientation.yawDegrees))
    .replaceAll("__PITCH_DEGREES__", String(orientation.pitchDegrees))
    .replaceAll("__ROLL_DEGREES__", String(orientation.rollDegrees))
    .replaceAll("__FLIP_HORIZONTAL__", String(orientation.flipHorizontal))
    .replaceAll("__PAN_SIGN__", String(orientation.panSign))
    .replaceAll("__TILT_SIGN__", String(orientation.tiltSign))
    .replaceAll("__ROLL_SIGN__", String(orientation.rollSign));
}
```

Create `src/ui/public/preview.js`. The shader copies `lensRay`, the three rotations, and `equirectangularSample` from `src/model/reframe.ts`. Calibration constants are the substituted placeholders, passed in as uniforms.

```javascript
const yawDegrees = __YAW_DEGREES__;
const pitchDegrees = __PITCH_DEGREES__;
const rollDegrees = __ROLL_DEGREES__;
const flipHorizontal = __FLIP_HORIZONTAL__;
const panSign = __PAN_SIGN__;
const tiltSign = __TILT_SIGN__;
const rollSign = __ROLL_SIGN__;

const missingProxy = "This clip has no .LRF next to its .OSV.";
const noWebgl = "This browser cannot show the preview.";
const remuxFailed = "The preview proxy could not be prepared.";

const vertexSource = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentSource = `
precision mediump float;
uniform vec2 uResolution;
uniform sampler2D uFrame;
uniform float uPan;
uniform float uTilt;
uniform float uRoll;
uniform float uFov;
uniform float uCorrection;
uniform float uYaw;
uniform float uPitch;
uniform float uRollOffset;
uniform float uPanSign;
uniform float uTiltSign;
uniform float uRollSign;
uniform float uFlip;

vec3 rotateX(vec3 p, float degrees) {
  float a = radians(degrees);
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}

vec3 rotateY(vec3 p, float degrees) {
  float a = radians(degrees);
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

vec3 rotateZ(vec3 p, float degrees) {
  float a = radians(degrees);
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
}

vec3 lensRay(float nx, float ny) {
  float fov = uFov;
  if (!(fov > 0.0001)) fov = 0.0001;
  if (fov > 179.0) fov = 179.0;
  float scale = tan(radians(fov) * 0.5);
  vec2 point = vec2(nx, ny) * scale;
  float radius = length(point);
  if (radius == 0.0) return vec3(0.0, 0.0, 1.0);
  float theta = max(0.0, 1.0 + uCorrection) * atan(radius);
  theta = min(3.141592653589793, theta);
  float spread = sin(theta) / radius;
  return vec3(point.x * spread, point.y * spread, cos(theta));
}

void main() {
  float nx = ((gl_FragCoord.x / uResolution.x) * 2.0 - 1.0) * (16.0 / 9.0);
  float ny = (gl_FragCoord.y / uResolution.y) * 2.0 - 1.0;
  float pan = uPanSign * uPan + uYaw;
  float tilt = uTiltSign * uTilt + uPitch;
  float roll = uRollSign * uRoll + uRollOffset;
  vec3 ray = lensRay(nx, ny);
  ray = rotateZ(ray, -roll);
  ray = rotateX(ray, -tilt);
  ray = rotateY(ray, pan);
  float rayLength = max(length(ray), 0.000001);
  vec3 direction = ray / rayLength;
  float longitude = atan(direction.x, direction.z);
  float latitude = asin(clamp(direction.y, -1.0, 1.0));
  float u = 0.5 + longitude / (2.0 * 3.141592653589793);
  if (uFlip > 0.5) u = 1.0 - u;
  float v = 0.5 - latitude / 3.141592653589793;
  gl_FragColor = texture2D(uFrame, vec2(u, v));
}
`;

const FramePreview = {
  mount(elements) {
    this.canvas = elements.canvas;
    this.video = elements.video;
    this.message = elements.message;
    this.playButton = elements.playButton;
    this.pauseButton = elements.pauseButton;
    this.scrubber = elements.scrubber;
    this.token = elements.token;
    this.view = null;
    this.clip = null;
    this.draftPath = "";
    this.visible = true;
    this.generation = 0;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.looping = false;
    this.frame = 0;
    this.gl = this.canvas.getContext("webgl", { premultipliedAlpha: false });
    this.video.muted = true;
    this.video.defaultMuted = true;
    this.video.volume = 0;
    this.video.playsInline = true;
    this.playButton.addEventListener("click", () => {
      void this.video.play();
    });
    this.pauseButton.addEventListener("click", () => {
      this.video.pause();
    });
    this.scrubber.addEventListener("input", () => {
      const next = Number(this.scrubber.value);
      if (Number.isFinite(next)) this.video.currentTime = next;
    });
    this.video.addEventListener("timeupdate", () => this.keepInside());
    this.video.addEventListener("ended", () => this.keepInside());
    this.video.addEventListener("seeked", () => {
      this.scrubber.value = String(this.video.currentTime);
    });
    if (this.gl === null) {
      this.showMessage(noWebgl);
      return;
    }
    this.program = this.createProgram(this.gl);
    this.texture = this.gl.createTexture();
    this.buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      this.gl.STATIC_DRAW,
    );
    const position = this.gl.getAttribLocation(this.program, "position");
    this.gl.enableVertexAttribArray(position);
    this.gl.vertexAttribPointer(position, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.useProgram(this.program);
    this.uniform("uYaw", yawDegrees);
    this.uniform("uPitch", pitchDegrees);
    this.uniform("uRollOffset", rollDegrees);
    this.uniform("uPanSign", panSign);
    this.uniform("uTiltSign", tiltSign);
    this.uniform("uRollSign", rollSign);
    this.uniform("uFlip", flipHorizontal ? 1 : 0);
    this.draw();
  },

  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      this.video.pause();
      window.cancelAnimationFrame(this.frame);
      return;
    }
    this.draw();
  },

  setView(view) {
    this.view = view;
  },

  showClip(draftPath, clip) {
    const ticket = ++this.generation;
    this.clip = clip;
    this.draftPath = draftPath;
    this.looping = false;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.armScrubber(0, 0, false);
    if (!clip.proxyReady) {
      this.showMessage(missingProxy);
      return;
    }
    if (this.gl === null) {
      this.showMessage(noWebgl);
      return;
    }
    this.showMessage("");
    const url = `/api/media?path=${encodeURIComponent(draftPath)}&clip=${clip.index}&t=${encodeURIComponent(this.token)}`;
    void this.load(url, ticket);
  },

  async load(url, ticket) {
    const probe = await fetch(url, { headers: { Range: "bytes=0-0" } });
    if (ticket !== this.generation) return;
    const type = probe.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await probe.json();
      this.showMessage(
        typeof body.error === "string" ? body.error : remuxFailed,
      );
      return;
    }
    await probe.arrayBuffer();
    if (ticket !== this.generation) return;
    this.video.src = url;
    this.video.addEventListener(
      "loadedmetadata",
      () => {
        if (ticket !== this.generation) return;
        this.seekToInPoint();
      },
      { once: true },
    );
  },

  seekToInPoint() {
    const duration = this.video.duration;
    const start = this.clip.timeStart / 1_000_000;
    const end = this.clip.timeEnd / 1_000_000;
    if (!(end > start) || !Number.isFinite(duration)) {
      this.video.pause();
      this.video.currentTime = 0;
      this.armScrubber(0, 0, false);
      return;
    }
    const loopStart = Math.min(Math.max(start, 0), duration);
    const loopEnd = Math.min(Math.max(end, 0), duration);
    this.loopStart = loopStart;
    this.loopEnd = loopEnd;
    this.looping = loopEnd > loopStart;
    this.video.pause();
    this.video.currentTime = this.looping ? loopStart : 0;
    this.armScrubber(
      this.looping ? loopStart : 0,
      this.looping ? loopEnd : 0,
      this.looping,
    );
  },

  keepInside() {
    this.scrubber.value = String(this.video.currentTime);
    if (!this.looping || this.video.paused) return;
    if (this.video.currentTime >= this.loopEnd - 0.05) {
      this.video.currentTime = this.loopStart;
    }
  },

  armScrubber(start, end, enabled) {
    this.scrubber.min = String(start);
    this.scrubber.max = String(end);
    this.scrubber.value = String(start);
    this.scrubber.disabled = !enabled;
    this.playButton.disabled = !enabled;
    this.pauseButton.disabled = !enabled;
  },

  showMessage(text) {
    const empty = text.length === 0;
    this.message.hidden = empty;
    this.message.textContent = text;
    if (!empty) this.armScrubber(0, 0, false);
  },

  draw() {
    window.cancelAnimationFrame(this.frame);
    if (!this.visible || this.gl === null) return;
    this.frame = window.requestAnimationFrame(() => this.draw());
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    this.uniform("uResolution", this.canvas.width, this.canvas.height);
    const view = this.view ?? {
      pan: 0,
      tilt: 0,
      roll: 0,
      fov: 60,
      correction: 0,
    };
    this.uniform("uPan", view.pan);
    this.uniform("uTilt", view.tilt);
    this.uniform("uRoll", view.roll);
    this.uniform("uFov", view.fov);
    this.uniform("uCorrection", view.correction);
    if (this.video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.video,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  },

  resize() {
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round((width * 9) / 16));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  },

  uniform(name, a, b) {
    const location = this.gl.getUniformLocation(this.program, name);
    if (b === undefined) this.gl.uniform1f(location, a);
    else this.gl.uniform2f(location, a, b);
  },

  createProgram(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, this.compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(
      program,
      this.compile(gl, gl.FRAGMENT_SHADER, fragmentSource),
    );
    gl.linkProgram(program);
    return program;
  },

  compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  },
};

window.FramePreview = FramePreview;
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run tests/ui-server.test.ts -t "substitutes preview"`

Expected: PASS. `new Function(source)` parses the substituted script.

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/preview.js src/ui/server.ts tests/ui-server.test.ts
git commit -m "$(cat <<'EOF'
Port the reframe into a WebGL preview and inject its calibration.

The shader has to match the model exactly, and the orientation stays one record on the server.
EOF
)"
```

---

### Task 5: Monitor in the glass

**Files:**

- Modify: `src/ui/public/index.html`
- Modify: `src/ui/public/app.css`
- Modify: `src/ui/public/app.js`
- Do not modify: `src/app/main.ts`

**Interfaces:**

- Consumes: `window.FramePreview` and `window.FRAME_TOKEN`.
- Produces: a Preview button, a 16:9 picture above the spirit level, and playback that loops the clip range.

- [ ] **Step 1: Add the picture markup**

In `src/ui/public/index.html`, inside `.glass-head`, after the signature paragraph:

```html
<button
  id="preview-toggle"
  class="preview-toggle"
  type="button"
  aria-pressed="true"
>
  Preview
</button>
```

Between `.glass-head` and `#level-caption`:

```html
<section id="picture" class="picture" aria-label="Preview">
  <div class="picture-frame">
    <canvas id="picture-canvas"></canvas>
    <p id="picture-message" class="picture-message" hidden></p>
    <video id="picture-video" class="preview-source" playsinline muted></video>
  </div>
  <div class="transport">
    <button id="picture-play" type="button">Play</button>
    <button id="picture-pause" type="button">Pause</button>
    <input
      id="picture-scrub"
      type="range"
      min="0"
      max="0"
      step="0.01"
      value="0"
      aria-label="Scrub"
    />
  </div>
</section>
```

Before `<script src="/app.js"></script>`:

```html
<script src="/preview.js"></script>
```

- [ ] **Step 2: Style the picture**

Append to `src/ui/public/app.css`:

```css
.preview-toggle {
  margin-top: 8px;
}

.preview-toggle[aria-pressed="false"] {
  opacity: 0.55;
}

.picture {
  margin-top: 12px;
}

.picture-frame {
  position: relative;
  background: #120f0c;
}

.picture-frame canvas {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
}

.picture-message {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 16px;
  text-align: center;
  color: var(--muted);
}

.picture-message[hidden] {
  display: none;
}

.preview-source {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.transport {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
```

Leave `body { overflow: hidden }` and the Electron window size alone. `.glass` already scrolls.

- [ ] **Step 3: Wire the desk to the picture**

In `src/ui/public/app.js`:

- Query `#preview-toggle`, `#picture`, `#picture-canvas`, `#picture-video`, `#picture-message`, `#picture-play`, `#picture-pause`, and `#picture-scrub`.
- After the existing listeners, mount once:

```javascript
const previewStorageKey = "frame-desk-preview";

FramePreview.mount({
  canvas: pictureCanvas,
  video: pictureVideo,
  message: pictureMessage,
  playButton: picturePlay,
  pauseButton: picturePause,
  scrubber: pictureScrub,
  token,
});

function previewHidden() {
  return localStorage.getItem(previewStorageKey) === "hidden";
}

function paintPreviewToggle() {
  const hidden = previewHidden();
  previewToggle.setAttribute("aria-pressed", String(!hidden));
  picture.hidden = hidden;
  FramePreview.setVisible(!hidden);
}

previewToggle.addEventListener("click", () => {
  if (previewHidden()) {
    localStorage.removeItem(previewStorageKey);
  } else {
    localStorage.setItem(previewStorageKey, "hidden");
  }
  paintPreviewToggle();
  showCurrentClip();
});

function showCurrentClip() {
  if (picture.hidden || state.draft === null) return;
  const clip =
    state.draft.clips.find((item) => item.index === state.clipIndex) ??
    state.draft.clips[0];
  if (!clip) return;
  FramePreview.showClip(state.draft.draftPath, clip);
}

paintPreviewToggle();
```

- At the end of `paintLevel`, after the caption update, push the form into the shader. This is the next-frame update for drags and field edits. Do not call `schedulePreview` from here; that timer already runs on `input`.

```javascript
FramePreview.setView(view);
```

- At the end of `paintDraft`, after `schedulePreview()`:

```javascript
showCurrentClip();
```

`showClip` reloads when the clip changes. `setView` does not. The debounced `/api/preview` change list is untouched.

- [ ] **Step 4: Check the desk builds and the tests still pass**

Run: `pnpm typecheck && pnpm test`

Expected: PASS. There is no browser test for the canvas. The manual check is the spec’s list: baseline, pan, tilt, horizon, FOV, and correction; the scrubber stays inside the clip; previewing does not write `draft.json`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/index.html src/ui/public/app.css src/ui/public/app.js
git commit -m "$(cat <<'EOF'
Show the live reframe above the spirit level.

The picture follows the form immediately, and the desk still writes the draft only from Write.
EOF
)"
```
