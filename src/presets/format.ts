import { formatCameraView } from "../model/format-view.js";
import { displayPath } from "../paths.js";
import type { Preset } from "./library.js";

export function formatPresetList(
  filePath: string,
  presets: readonly Preset[],
): string {
  const lines = [`Library    ${displayPath(filePath)}`, ""];
  if (presets.length === 0) {
    lines.push("No presets.");
    return lines.join("\n");
  }
  for (const preset of presets) {
    lines.push(preset.name, formatCameraView(preset.view), "");
  }
  return lines.join("\n").trimEnd();
}

export function formatSavedPreset(preset: Preset, replaced: boolean): string {
  return [
    `${replaced ? "Replaced" : "Saved"} ${preset.name}`,
    formatCameraView(preset.view),
  ].join("\n");
}
