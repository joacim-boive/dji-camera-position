import type { Command } from "commander";
import {
  offsetWithPatch,
  tuplesEqual,
  viewFromOffset,
  type CameraView,
  type CameraViewPatch,
} from "../model/camera-view.js";
import {
  clipAt,
  readDraftViews,
  resolveDraftFile,
  writeClipView,
} from "../model/draft-document.js";
import { formatDraftViews, formatViewChange } from "../model/format-view.js";
import { resolveUserPath } from "../paths.js";
import { assertStudioQuit } from "../studio.js";

export function registerViewCommands(program: Command): void {
  const view = program
    .command("view")
    .description("Read or copy the free-camera view stored in draft.json.");

  view
    .command("show")
    .description("Print pan, tilt, roll, FOV, and correction for each clip.")
    .argument("<project-or-draft>", "project directory or draft.json")
    .action(async (target: string) => {
      const draftPath = await resolveDraftFile(resolveUserPath(target));
      const report = await readDraftViews(draftPath);
      process.stdout.write(`${formatDraftViews(report)}\n`);
    });

  view
    .command("set")
    .description(
      "Change one clip's free view. Pass negative numbers as --pan=-180. Nothing is written unless --write is set.",
    )
    .argument("<project-or-draft>", "project directory or draft.json")
    .requiredOption("--clip <index>", "clip number, starting at 1")
    .option("--pan <degrees>", "displayed pan in degrees")
    .option("--tilt <degrees>", "displayed tilt in degrees")
    .option("--roll <degrees>", "displayed roll in degrees")
    .option("--fov <degrees>", "displayed field of view in degrees")
    .option("--correction <value>", "displayed correction")
    .option("--write", "back up draft.json, then update that clip")
    .action(async (target: string, options: SetOptions) => {
      const patch: CameraViewPatch = {};
      if (options.pan !== undefined) {
        patch.pan = parseNumber(options.pan, "--pan");
      }
      if (options.tilt !== undefined) {
        patch.tilt = parseNumber(options.tilt, "--tilt");
      }
      if (options.roll !== undefined) {
        patch.roll = parseNumber(options.roll, "--roll");
      }
      if (options.fov !== undefined) {
        patch.fov = parseNumber(options.fov, "--fov");
      }
      if (options.correction !== undefined) {
        patch.correction = parseNumber(options.correction, "--correction");
      }
      if (
        patch.pan === undefined &&
        patch.tilt === undefined &&
        patch.roll === undefined &&
        patch.fov === undefined &&
        patch.correction === undefined
      ) {
        throw new Error(
          "Set at least one of --pan, --tilt, --roll, --fov, or --correction.",
        );
      }
      await applyClipPatch(
        target,
        parseClip(options.clip),
        patch,
        options.write === true,
      );
    });

  view
    .command("copy")
    .description(
      "Copy the static free view from one clip to another. Keyframes and direction lock stay put. Nothing is written unless --write is set.",
    )
    .argument("<project-or-draft>", "project directory or draft.json")
    .requiredOption("--from <index>", "source clip number, starting at 1")
    .requiredOption("--to <index>", "destination clip number, starting at 1")
    .option("--write", "back up draft.json, then update the destination clip")
    .action(async (target: string, options: CopyOptions) => {
      const draftPath = await resolveDraftFile(resolveUserPath(target));
      const report = await readDraftViews(draftPath);
      const source = clipAt(report.clips, parseClip(options.from));
      const destinationIndex = parseClip(options.to);
      const destination = clipAt(report.clips, destinationIndex);
      const notes: string[] = [];
      if (source.keyframes.length > 0 && source.index !== destination.index) {
        notes.push(
          `Clip ${source.index} has keyframes. Copying the static view only.`,
        );
      }
      await applyClipPatch(
        target,
        destinationIndex,
        source.view,
        options.write === true,
        notes,
      );
    });
}

type SetOptions = {
  clip: string;
  pan?: string;
  tilt?: string;
  roll?: string;
  fov?: string;
  correction?: string;
  write?: boolean;
};

type CopyOptions = {
  from: string;
  to: string;
  write?: boolean;
};

type Preview = {
  changed: boolean;
  before: CameraView;
  after: CameraView;
};

export async function applyClipPatch(
  target: string,
  clipIndex: number,
  patch: CameraViewPatch,
  write: boolean,
  notes: readonly string[] = [],
): Promise<void> {
  const draftPath = await resolveDraftFile(resolveUserPath(target));
  const report = await readDraftViews(draftPath);
  const clip = clipAt(report.clips, clipIndex);
  const preview = previewPatch(report.clips, clipIndex, patch);
  const viewNotes = [...notes];
  if (clip.keyframes.length > 0) {
    viewNotes.push(
      `Clip ${clipIndex} has keyframes. This updates the static view only.`,
    );
  }
  if (!preview.changed) {
    process.stdout.write(`Clip ${clipIndex} already has that view.\n`);
    return;
  }
  if (!write) {
    process.stdout.write(
      `${formatViewChange({
        clipIndex,
        before: preview.before,
        after: preview.after,
        notes: viewNotes,
        dryRun: true,
      })}\n`,
    );
    return;
  }
  if (!report.signatureMatches) {
    throw new Error(
      "The crc32 signature does not match this draft. Refusing to write.",
    );
  }
  await assertStudioQuit();
  const result = await writeClipView(draftPath, clipIndex, patch);
  if (!result.changed) {
    process.stdout.write(`Clip ${clipIndex} already has that view.\n`);
    return;
  }
  process.stdout.write(
    `${formatViewChange({
      clipIndex,
      before: result.before,
      after: result.after,
      notes: viewNotes,
      dryRun: false,
      ...(result.backupPath === undefined
        ? {}
        : { backupPath: result.backupPath }),
    })}\n`,
  );
}

function previewPatch(
  clips: Parameters<typeof clipAt>[0],
  clipIndex: number,
  patch: CameraViewPatch,
): Preview {
  const clip = clipAt(clips, clipIndex);
  const nextOffset = offsetWithPatch(clip.viewParam, clip.viewOffset, patch);
  return {
    changed: !tuplesEqual(clip.viewOffset, nextOffset),
    before: clip.view,
    after: viewFromOffset(clip.viewParam, nextOffset),
  };
}

function parseClip(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Clip numbers start at 1.");
  }
  return parsed;
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a number.`);
  }
  return parsed;
}
