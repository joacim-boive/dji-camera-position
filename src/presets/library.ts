import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseJsonText } from "../json.js";
import type { CameraView } from "../model/camera-view.js";

export type Preset = {
  name: string;
  view: CameraView;
};

const presetSchema = z
  .object({
    name: z.string(),
    pan: z.number().finite(),
    tilt: z.number().finite(),
    roll: z.number().finite(),
    fov: z.number().finite(),
    correction: z.number().finite(),
  })
  .strict();

const librarySchema = z
  .object({
    version: z.literal(1),
    presets: z.array(presetSchema),
  })
  .strict();

export function defaultPresetLibraryPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../presets/library.json",
  );
}

export function parsePresetLibrary(text: string): Preset[] {
  let value: unknown;
  try {
    value = parseJsonText(text);
  } catch {
    throw new Error("Preset library is not valid JSON.");
  }
  const parsed = librarySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Preset library must be version 1. Each preset needs name, pan, tilt, roll, fov, and correction.",
    );
  }
  const presets = parsed.data.presets.map((preset) => ({
    name: assertPresetName(preset.name),
    view: {
      pan: preset.pan,
      tilt: preset.tilt,
      roll: preset.roll,
      fov: preset.fov,
      correction: preset.correction,
    },
  }));
  const seen = new Set<string>();
  for (const preset of presets) {
    if (seen.has(preset.name)) {
      throw new Error(`Preset library lists ${preset.name} more than once.`);
    }
    seen.add(preset.name);
  }
  return presets;
}

export async function loadPresetLibrary(filePath: string): Promise<Preset[]> {
  try {
    return parsePresetLibrary(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

export type SaveResult = {
  action: "created" | "replaced";
  preset: Preset;
};

export async function savePreset(
  filePath: string,
  preset: Preset,
  force: boolean,
): Promise<SaveResult> {
  const name = assertPresetName(preset.name);
  const next = { name, view: preset.view };
  const presets = await loadPresetLibrary(filePath);
  const index = presets.findIndex((item) => item.name === name);
  if (index >= 0 && !force) {
    throw new Error(
      `Preset ${name} already exists. Re-run with --force to replace it.`,
    );
  }
  if (index >= 0) {
    presets[index] = next;
  } else {
    presets.push(next);
  }
  await writePresetLibrary(filePath, presets);
  return { action: index >= 0 ? "replaced" : "created", preset: next };
}

export async function deletePreset(
  filePath: string,
  name: string,
): Promise<string> {
  const presetName = assertPresetName(name);
  const presets = await loadPresetLibrary(filePath);
  const next = presets.filter((preset) => preset.name !== presetName);
  if (next.length === presets.length) {
    throw new Error(`No preset named ${presetName}.`);
  }
  await writePresetLibrary(filePath, next);
  return presetName;
}

export function presetNamed(presets: readonly Preset[], name: string): Preset {
  const presetName = assertPresetName(name);
  const preset = presets.find((item) => item.name === presetName);
  if (preset === undefined) {
    throw new Error(`No preset named ${presetName}.`);
  }
  return preset;
}

export function assertPresetName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 80 ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  ) {
    throw new Error(
      "Preset name must be 1–80 characters and must not contain a slash.",
    );
  }
  return trimmed;
}

async function writePresetLibrary(
  filePath: string,
  presets: readonly Preset[],
): Promise<void> {
  const text = `${JSON.stringify(
    {
      version: 1,
      presets: presets.map((preset) => ({
        name: preset.name,
        pan: preset.view.pan,
        tilt: preset.view.tilt,
        roll: preset.view.roll,
        fov: preset.view.fov,
        correction: preset.view.correction,
      })),
    },
    null,
    2,
  )}\n`;
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(tempPath, text, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
