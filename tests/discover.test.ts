import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nameMatches } from "../src/discovery/match.js";
import { discover } from "../src/discovery/scan.js";

describe("name matching", () => {
  it("matches DJI names and bundle ids without matching Spotlight", () => {
    expect(nameMatches("DJI Studio", [])).toBe(true);
    expect(nameMatches("Spotlight", ["com.light.studio"])).toBe(false);
    expect(
      nameMatches("com.light.studio.quicklook", ["com.light.studio"]),
    ).toBe(true);
    expect(nameMatches("com.insta360.studio", ["com.light.studio"])).toBe(
      false,
    );
    expect(nameMatches("Notes", [])).toBe(false);
  });
});

describe("discover", () => {
  it("finds a fixture project and does not modify it", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dji-discover-"));
    const app = path.join(home, "Applications", "DJI Studio.app", "Contents");
    const project = path.join(
      home,
      "Library",
      "Application Support",
      "DJI Studio",
      "project",
      "1",
      "nova",
    );
    const ignored = path.join(
      home,
      "Library",
      "Application Support",
      "Spotlight",
    );
    const cache = path.join(
      home,
      "Library",
      "Application Support",
      "DJI Studio",
      "cache",
    );
    await mkdir(app, { recursive: true });
    await mkdir(project, { recursive: true });
    await mkdir(ignored, { recursive: true });
    await mkdir(cache, { recursive: true });
    await writeFile(
      path.join(app, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.light.studio</string>
  <key>CFBundleName</key><string>DJI Studio</string>
  <key>CFBundleShortVersionString</key><string>9.9.9</string>
  <key>CFBundleVersion</key><string>1</string>
</dict></plist>`,
    );
    const draft = path.join(project, "draft.json");
    await writeFile(
      draft,
      '{"signature":"aa","signature_method":"crc32","data":{}}\n',
    );
    await writeFile(path.join(ignored, "secret.json"), "{}\n");
    await writeFile(path.join(cache, "preview.jpg"), "not-a-real-image");
    await mkdir(path.join(home, "Library", "Containers"), { recursive: true });
    await mkdir(path.join(home, "Library", "Group Containers"), {
      recursive: true,
    });
    await mkdir(path.join(home, "Library", "Preferences"), { recursive: true });
    await mkdir(path.join(home, "Movies"), { recursive: true });
    await mkdir(path.join(home, "Documents"), { recursive: true });

    const before = await stat(draft);
    const report = await discover({
      homeDir: home,
      applicationDirs: [path.join(home, "Applications")],
    });
    const after = await stat(draft);

    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
    expect(report.apps.map((app) => app.bundleId)).toContain(
      "com.light.studio",
    );
    const studio = report.locations.find((location) =>
      location.path.endsWith(`${path.sep}DJI Studio`),
    );
    expect(studio?.files.map((file) => file.relativePath)).toContain(
      path.join("project", "1", "nova", "draft.json"),
    );
    expect(
      studio?.files.some((file) => file.relativePath.includes("preview.jpg")),
    ).toBe(false);
    expect(
      report.locations.some((location) => location.path.endsWith("Spotlight")),
    ).toBe(false);
    expect(
      studio?.summaries.some((summary) => summary.relativePath === "cache"),
    ).toBe(true);
  });
});
