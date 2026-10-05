import type { Command } from "commander";
import {
  clipAt,
  readDraftViews,
  resolveDraftFile,
} from "../model/draft-document.js";
import { resolveUserPath } from "../paths.js";
import { formatPresetList, formatSavedPreset } from "../presets/format.js";
import {
  defaultPresetLibraryPath,
  deletePreset,
  loadPresetLibrary,
  presetNamed,
  savePreset,
  type Preset,
} from "../presets/library.js";
import { applyClipPatch } from "./view.js";

export function registerPresetCommands(program: Command): void {
  const preset = program
    .command("preset")
    .description(
      "Save and apply named free-camera views. Values are on-screen pan, tilt, roll, FOV, and correction.",
    );

  preset
    .command("list")
    .description("List saved presets.")
    .option(
      "--library <file>",
      "preset library JSON",
      defaultPresetLibraryPath(),
    )
    .action(async (options: LibraryOptions) => {
      const filePath = libraryPath(options);
      const presets = await loadPresetLibrary(filePath);
      process.stdout.write(`${formatPresetList(filePath, presets)}\n`);
    });

  preset
    .command("save")
    .description("Save one clip's static free view as a preset.")
    .argument("<name>", "preset name")
    .argument("<project-or-draft>", "project directory or draft.json")
    .requiredOption("--clip <index>", "clip number, starting at 1")
    .option("--force", "replace an existing preset of the same name")
    .option(
      "--library <file>",
      "preset library JSON",
      defaultPresetLibraryPath(),
    )
    .action(
      async (
        name: string,
        target: string,
        options: LibraryOptions & { clip: string; force?: boolean },
      ) => {
        const draftPath = await resolveDraftFile(resolveUserPath(target));
        const report = await readDraftViews(draftPath);
        const clip = clipAt(report.clips, parseClip(options.clip));
        const saved: Preset = { name, view: clip.view };
        const result = await savePreset(
          libraryPath(options),
          saved,
          options.force === true,
        );
        if (clip.keyframes.length > 0) {
          process.stdout.write(
            `Clip ${clip.index} has keyframes. The preset stores the static view only.\n`,
          );
        }
        process.stdout.write(
          `${formatSavedPreset(result.preset, result.action === "replaced")}\n`,
        );
      },
    );

  preset
    .command("apply")
    .description(
      "Apply a preset to one clip's free view. Nothing is written unless --write is set.",
    )
    .argument("<name>", "preset name")
    .argument("<project-or-draft>", "project directory or draft.json")
    .requiredOption("--clip <index>", "clip number, starting at 1")
    .option("--write", "back up draft.json, then update that clip")
    .option(
      "--library <file>",
      "preset library JSON",
      defaultPresetLibraryPath(),
    )
    .action(
      async (
        name: string,
        target: string,
        options: LibraryOptions & { clip: string; write?: boolean },
      ) => {
        const presets = await loadPresetLibrary(libraryPath(options));
        const preset = presetNamed(presets, name);
        await applyClipPatch(
          target,
          parseClip(options.clip),
          preset.view,
          options.write === true,
          [`Preset ${preset.name}`],
        );
      },
    );

  preset
    .command("delete")
    .description("Delete a preset.")
    .argument("<name>", "preset name")
    .option(
      "--library <file>",
      "preset library JSON",
      defaultPresetLibraryPath(),
    )
    .action(async (name: string, options: LibraryOptions) => {
      const filePath = libraryPath(options);
      const deleted = await deletePreset(filePath, name);
      process.stdout.write(`Deleted ${deleted}\n`);
    });
}

type LibraryOptions = {
  library?: string;
};

function libraryPath(options: LibraryOptions): string {
  return resolveUserPath(options.library ?? defaultPresetLibraryPath());
}

function parseClip(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Clip numbers start at 1.");
  }
  return parsed;
}
