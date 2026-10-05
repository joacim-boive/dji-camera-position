import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseDraftViews,
  resolveDraftFile,
  writeClipView,
} from "../src/model/draft-document.js";
import { formatDraftViews } from "../src/model/format-view.js";
import { crc32Hex } from "../src/model/signature.js";

function wrap(data: string): string {
  return `{"signature":"${crc32Hex(data)}","signature_method":"crc32","data":${data}}`;
}

function sampleData(clip2Offset = "[0.0,0.0,0.0,0.0,0.0]"): string {
  return `{"nodes":[{"__type__":"Track","id":"track-1","volume":1.0,"clips":[{"id":"video-1"},{"id":"video-2"}]},{"__type__":"PanoramaVideo","id":"video-1","time_range":[0,8200000],"freedom_view_id":"view-1","freedom_kfs_id":"kfs-1"},{"__type__":"PanoramaVideo","id":"video-2","time_range":[8200000,16400000],"freedom_view_id":"view-2"},{"__type__":"PanoramaViewData","id":"view-1","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0],"mystery_component":1.0},{"__type__":"PanoramaViewData","id":"view-2","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":${clip2Offset}},{"__type__":"PanoramaViewKeyframes","id":"kfs-1","keyframes":[{"p":4366667,"v":[0.0,0.0,0.0,60.0,1.0],"e":3}]}]}`;
}

describe("draft views", () => {
  it("reads clips in track order and checks the crc32 signature", () => {
    const report = parseDraftViews(
      "draft.json",
      wrap(sampleData("[0.0,-3.1415927410125732,0.0,0.0,0.0]")),
    );
    expect(report.signatureMatches).toBe(true);
    expect(report.clips.map((clip) => clip.videoId)).toEqual([
      "video-1",
      "video-2",
    ]);
    const clip2 = report.clips[1];
    expect(clip2?.view.pan).toBeCloseTo(-180, 4);
    expect(clip2?.view.fov).toBe(60);
    expect(report.clips[0]?.keyframes[0]?.view.fov).toBe(60);
    expect(formatDraftViews(report)).toContain("Keyframe 1  4.367 s");
    expect(formatDraftViews(report)).toContain("-180.0°");
  });

  it("replaces one view_offset, recomputes crc32, and keeps other number formatting", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dji-draft-"));
    const draftPath = path.join(
      directory,
      "nova",
      "draft.proj",
      "8",
      "draft.json",
    );
    await mkdir(path.dirname(draftPath), { recursive: true });
    await writeFile(draftPath, wrap(sampleData()));

    const result = await writeClipView(draftPath, 2, { correction: 0 });
    const text = await readFile(draftPath, "utf8");
    expect(result.changed).toBe(true);
    expect(text).toContain('"view_offset":[0.0,0.0,0.0,0.0,-1.0]');
    expect(text).toContain('"view_offset":[0.0,0.0,0.0,0.0,0.0]');
    expect(text).toContain('"volume":1.0');
    expect(text).toContain('"mystery_component":1.0');
    expect(parseDraftViews(draftPath, text).signatureMatches).toBe(true);
    expect(parseDraftViews(draftPath, text).clips[1]?.view.correction).toBe(0);
    expect(await resolveDraftFile(directory)).toBe(draftPath);

    const full = await writeClipView(draftPath, 2, {
      pan: -180,
      tilt: 90,
      roll: -90,
      fov: 20,
      correction: 0,
    });
    const rewritten = await readFile(draftPath, "utf8");
    expect(full.changed).toBe(true);
    expect(rewritten).toContain(
      '"view_offset":[1.5707963705062866,-3.1415927410125732,1.5707963705062866,-40.0,-1.0]',
    );
    expect(rewritten).toContain('"volume":1.0');
    expect(parseDraftViews(draftPath, rewritten).signatureMatches).toBe(true);
  });

  it("refuses a draft whose signature does not match", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dji-draft-"));
    const draftPath = path.join(directory, "draft.json");
    const original = wrap(sampleData()).replace(
      '"signature":"',
      '"signature":"00000000',
    );
    await writeFile(draftPath, original);
    await expect(writeClipView(draftPath, 2, { pan: -180 })).rejects.toThrow(
      /signature/,
    );
    expect(await readFile(draftPath, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual(["draft.json"]);
  });
});
