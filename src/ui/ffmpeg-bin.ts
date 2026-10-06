import path from "node:path";

export const bundledFfmpeg = {
  version: "7.1.5",
  sourceUrl: "https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz",
  configure: [
    "--disable-gpl",
    "--disable-nonfree",
    "--disable-debug",
    "--disable-doc",
    "--disable-ffplay",
    "--disable-ffprobe",
    "--disable-avdevice",
    "--disable-network",
    "--disable-shared",
    "--enable-static",
    "--enable-small",
    "--disable-encoders",
    "--disable-decoders",
    "--disable-hwaccels",
    "--disable-x86asm",
  ],
} as const;

export type FfmpegPathInput = {
  resourcesDir?: string;
  override?: string;
};

export function resolveFfmpegPath(input: FfmpegPathInput = {}): string {
  const override = input.override?.trim() ?? "";
  if (override !== "") {
    return override;
  }
  if (input.resourcesDir !== undefined && input.resourcesDir !== "") {
    return path.join(input.resourcesDir, "ffmpeg");
  }
  return "ffmpeg";
}

export function ffmpegNotice(binaryPath: string): string {
  const session = path.isAbsolute(binaryPath)
    ? `This session uses ${binaryPath}.`
    : `This session uses the "${binaryPath}" command on PATH. The packaged app uses Contents/Resources/ffmpeg.`;
  return [
    `Frame Desk's production build includes FFmpeg ${bundledFfmpeg.version}, licensed under the GNU Lesser General Public License version 2.1 or later.`,
    "",
    "The binary is built from the official source archive",
    bundledFfmpeg.sourceUrl,
    "with these options:",
    bundledFfmpeg.configure.join(" "),
    "",
    "That archive is the corresponding source. The binary sits at Contents/Resources/ffmpeg, outside the application archive, so it can be replaced with another build under the same license.",
    "",
    session,
  ].join("\n");
}
