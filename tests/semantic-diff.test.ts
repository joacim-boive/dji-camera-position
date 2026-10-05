import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatSemanticDiff } from "../src/diff/format.js";
import { hypothesize } from "../src/diff/hypotheses.js";
import { diffValues } from "../src/diff/semantic-diff.js";
import { parseJsonText } from "../src/json.js";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/synthetic",
);

describe("semantic diff", () => {
  it("shows view tuple indexes and unknown fields without renaming them", () => {
    const before = parseJsonText(
      readFileSync(path.join(fixtureDir, "before.json"), "utf8"),
    );
    const after = parseJsonText(
      readFileSync(path.join(fixtureDir, "after.json"), "utf8"),
    );
    const diff = diffValues(before, after);
    const paths = diff.changes.map((change) => change.path);

    expect(paths).toContain("data.nodes[0].view_offset[0]");
    expect(paths).toContain("data.nodes[0].view_offset[3]");
    expect(paths).toContain("data.nodes[0].mystery_component");
    expect(paths).not.toContain("data.nodes[0].id");
    expect(paths).not.toContain("signature");
    expect(paths).not.toContain("created_at");
    expect(diff.noise.map((hit) => hit.path)).toEqual(
      expect.arrayContaining([
        "signature",
        "created_at",
        "data.nodes[0].id",
        "data.nodes[1].cache_path",
      ]),
    );

    const offset = diff.changes.find(
      (change) => change.path === "data.nodes[0].view_offset[0]",
    );
    expect(offset?.hypothesis?.confidence).toBe("high");
    expect(offset?.hypothesis?.candidate).toContain("tilt");
    expect(offset?.hypothesis?.candidate.toLowerCase()).not.toContain("yaw");
    expect(offset?.hypothesis?.reason).toContain("controlled edit");

    const mystery = diff.changes.find(
      (change) => change.path === "data.nodes[0].mystery_component",
    );
    expect(mystery?.hypothesis).toBeUndefined();

    const text = formatSemanticDiff(diff);
    expect(text).toContain("data.nodes[0].view_offset[0]");
    expect(text).toContain("before: 0");
    expect(text).toContain("after:  1.5707963267948966");
    expect(text).not.toContain("yaw:");
  });

  it("keeps an unchanged unknown field out of the diff", () => {
    const diff = diffValues(
      { unrelated_label: "keep-me", view_offset: [0, 0, 0, 0, 0] },
      {
        unrelated_label: "keep-me",
        view_offset: [0.2, 0, 0, 0, 0],
      },
    );
    expect(diff.changes.map((change) => change.path)).toEqual([
      "view_offset[0]",
    ]);
  });

  it("labels a literal fov key as a hypothesis and leaves unknown keys alone", () => {
    expect(hypothesize("fov", 60, 80)?.candidate).toBe("field of view");
    expect(hypothesize("some_unknown", 1, 2)).toBeUndefined();
  });

  it("labels the confirmed view tuple indexes", () => {
    expect(hypothesize("view_offset[1]", 0, 1)?.candidate).toContain("pan");
    expect(hypothesize("view_offset[2]", 0, 1)?.candidate).toContain("roll");
    expect(hypothesize("view_offset[3]", 0, 1)?.candidate).toContain("FOV");
    expect(hypothesize("view_offset[4]", 0, 1)?.candidate).toContain(
      "correction",
    );
    expect(hypothesize("nodes[0].keyframes[0].v[3]", 60, 70)?.confidence).toBe(
      "medium",
    );
  });
});
