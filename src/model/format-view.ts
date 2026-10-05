import { displayPath } from "../paths.js";
import type { CameraView } from "./camera-view.js";
import type { ClipKeyframe, DraftViewReport } from "./draft-document.js";

export function formatDraftViews(report: DraftViewReport): string {
  const lines = [
    `Draft      ${displayPath(report.draftPath)}`,
    `Signature  ${report.signature || "(none)"}  ${report.signatureMethod || "(none)"}  ${report.signatureMatches ? "matches" : "does not match"}`,
    "",
  ];
  for (const clip of report.clips) {
    lines.push(
      `Clip ${clip.index}     ${formatMicros(clip.timeStart)} – ${formatMicros(clip.timeEnd)}`,
    );
    lines.push(formatCameraView(clip.view));
    if (clip.hasDirectionLockView) {
      lines.push("Direction lock view is present. This reads the free view.");
    }
    for (const [index, keyframe] of clip.keyframes.slice(0, 8).entries()) {
      lines.push(formatKeyframe(index + 1, keyframe));
    }
    if (clip.keyframes.length > 8) {
      lines.push(`${clip.keyframes.length - 8} more keyframes.`);
    }
    lines.push("");
  }
  lines.push(
    "Zoom is calculated by DJI Studio from FOV and correction. It is not stored.",
  );
  return lines.join("\n").trimEnd();
}

export function formatViewChange(input: {
  clipIndex: number;
  before: CameraView;
  after: CameraView;
  notes: readonly string[];
  dryRun: boolean;
  backupPath?: string;
}): string {
  const lines = [`Clip ${input.clipIndex}`, ...input.notes];
  lines.push(...formatChangedFields(input.before, input.after));
  lines.push("");
  if (input.backupPath !== undefined) {
    lines.push(
      `Updated ${displayPath(input.backupPath.replace(/\.backup-.*$/, ""))}`,
    );
    lines.push(`Backup  ${displayPath(input.backupPath)}`);
  } else if (input.dryRun) {
    lines.push("Dry run. Re-run with --write to update the draft.");
  }
  return lines.join("\n").trimEnd();
}

export function formatDegrees(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Object.is(rounded, -0) ? "0.0" : rounded.toFixed(1);
  return `${text}°`;
}

export function formatCorrection(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0.00" : rounded.toFixed(2);
}

export function formatMicros(us: number): string {
  return `${(us / 1_000_000).toFixed(3)} s`;
}

export function formatCameraView(view: CameraView): string {
  return [
    field("Pan", formatDegrees(view.pan)),
    field("Tilt", formatDegrees(view.tilt)),
    field("Roll", formatDegrees(view.roll)),
    field("FOV", formatDegrees(view.fov)),
    field("Correction", formatCorrection(view.correction)),
  ].join("\n");
}

function formatChangedFields(before: CameraView, after: CameraView): string[] {
  return [
    changed("Pan", formatDegrees(before.pan), formatDegrees(after.pan)),
    changed("Tilt", formatDegrees(before.tilt), formatDegrees(after.tilt)),
    changed("Roll", formatDegrees(before.roll), formatDegrees(after.roll)),
    changed("FOV", formatDegrees(before.fov), formatDegrees(after.fov)),
    changed(
      "Correction",
      formatCorrection(before.correction),
      formatCorrection(after.correction),
    ),
  ];
}

function formatKeyframe(index: number, keyframe: ClipKeyframe): string {
  const time =
    keyframe.timeUs === undefined ? "no time" : formatMicros(keyframe.timeUs);
  return `Keyframe ${index}  ${time}  pan ${formatDegrees(keyframe.view.pan)}  tilt ${formatDegrees(keyframe.view.tilt)}  roll ${formatDegrees(keyframe.view.roll)}  fov ${formatDegrees(keyframe.view.fov)}  correction ${formatCorrection(keyframe.view.correction)}`;
}

function field(label: string, value: string): string {
  return `${label.padEnd(12)}${value}`;
}

function changed(label: string, before: string, after: string): string {
  return field(label, before === after ? after : `${before} → ${after}`);
}
