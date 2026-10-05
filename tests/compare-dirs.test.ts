import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comparePaths, formatComparison } from "../src/diff/compare.js";

describe("directory diff pairing", () => {
  it("pairs draft.json when only the generation directory changed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dji-diff-"));
    const before = path.join(root, "before", "nova", "draft.proj", "176");
    const after = path.join(root, "after", "nova", "draft.proj", "180");
    await mkdir(before, { recursive: true });
    await mkdir(after, { recursive: true });
    await writeFile(
      path.join(before, "draft.json"),
      JSON.stringify({
        signature: "aa",
        signature_method: "crc32",
        data: { view_offset: [0, 0, 0, 60, 1] },
      }),
    );
    await writeFile(
      path.join(after, "draft.json"),
      JSON.stringify({
        signature: "bb",
        signature_method: "crc32",
        data: { view_offset: [0.5, 0, 0, 60, 1] },
      }),
    );

    const report = await comparePaths(
      path.join(root, "before"),
      path.join(root, "after"),
    );
    expect(report.files).toHaveLength(1);
    expect(report.files[0]?.pairing).toBe("unique-filename");
    expect(
      report.files[0]?.semantic?.changes.map((change) => change.path),
    ).toContain("data.view_offset[0]");
    expect(report.unmatchedBefore).toEqual([]);
    expect(report.unmatchedAfter).toEqual([]);

    const text = formatComparison(report);
    expect(text).toContain("paired by filename");
    expect(text).toContain("data.view_offset[0]");
  });
});
