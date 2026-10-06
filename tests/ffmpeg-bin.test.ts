import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledFfmpeg,
  ffmpegNotice,
  resolveFfmpegPath,
} from "../src/ui/ffmpeg-bin.js";

describe("ffmpeg binary", () => {
  it("uses PATH unless a resources directory or override is set", () => {
    expect(resolveFfmpegPath()).toBe("ffmpeg");
    expect(resolveFfmpegPath({ resourcesDir: "/Apps/Frame Desk.app/Contents/Resources" })).toBe(
      path.join("/Apps/Frame Desk.app/Contents/Resources", "ffmpeg"),
    );
    expect(
      resolveFfmpegPath({
        resourcesDir: "/Apps/Frame Desk.app/Contents/Resources",
        override: "/opt/ffmpeg",
      }),
    ).toBe("/opt/ffmpeg");
  });

  it("describes the LGPL build and where this session finds ffmpeg", () => {
    const fromPath = ffmpegNotice("ffmpeg");
    expect(fromPath).toContain(`FFmpeg ${bundledFfmpeg.version}`);
    expect(fromPath).toContain("Lesser General Public License");
    expect(fromPath).toContain("--disable-gpl");
    expect(fromPath).toContain("--disable-nonfree");
    expect(fromPath).toContain("command on PATH");
    expect(fromPath).not.toContain("--enable-gpl");

    const bundled = ffmpegNotice("/Apps/Frame Desk.app/Contents/Resources/ffmpeg");
    expect(bundled).toContain(
      "This session uses /Apps/Frame Desk.app/Contents/Resources/ffmpeg.",
    );
  });
});
