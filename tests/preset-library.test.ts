import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deletePreset,
  loadPresetLibrary,
  parsePresetLibrary,
  savePreset,
} from "../src/presets/library.js";

const wide = {
  name: "wide-left",
  view: { pan: -180, tilt: 90, roll: -90, fov: 20, correction: 0 },
};

describe("preset library", () => {
  it("stores screen values and replaces only with --force", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dji-presets-"));
    const filePath = path.join(directory, "library.json");
    expect(await loadPresetLibrary(filePath)).toEqual([]);

    const created = await savePreset(filePath, wide, false);
    expect(created.action).toBe("created");
    const text = await readFile(filePath, "utf8");
    expect(text).toContain('"pan": -180');
    expect(text).toContain('"fov": 20');
    expect(text).not.toContain("view_offset");
    expect(text).not.toContain("3.14159");

    await expect(savePreset(filePath, wide, false)).rejects.toThrow(/--force/);
    const replaced = await savePreset(
      filePath,
      { name: "wide-left", view: { ...wide.view, fov: 40 } },
      true,
    );
    expect(replaced.action).toBe("replaced");
    expect((await loadPresetLibrary(filePath))[0]?.view.fov).toBe(40);

    expect(await deletePreset(filePath, "wide-left")).toBe("wide-left");
    expect(await loadPresetLibrary(filePath)).toEqual([]);
  });

  it("rejects a library that adds fields or repeats a name", () => {
    expect(() =>
      parsePresetLibrary(
        JSON.stringify({
          version: 1,
          presets: [{ ...flat(wide), zoom: 183 }],
        }),
      ),
    ).toThrow(/version 1/);
    expect(() =>
      parsePresetLibrary(
        JSON.stringify({
          version: 1,
          presets: [flat(wide), flat(wide)],
        }),
      ),
    ).toThrow(/more than once/);
  });
});

function flat(preset: typeof wide): Record<string, number | string> {
  return { name: preset.name, ...preset.view };
}
