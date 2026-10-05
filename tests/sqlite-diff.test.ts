import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { comparePaths } from "../src/diff/compare.js";
import { inspectSqlite } from "../src/parser/sqlite.js";

describe("sqlite inspection and diff", () => {
  it("reads tables read-only and diffs a column without renaming it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "dji-sqlite-"));
    const before = path.join(directory, "before.db");
    const after = path.join(directory, "after.db");
    writeDatabase(before, "[0,0,0,0,0]", "2026-10-01T00:00:00Z");
    writeDatabase(after, "[1,0,0,0,0]", "2026-10-04T00:00:00Z");

    const inspection = inspectSqlite(before);
    expect(inspection.tables.map((table) => table.name)).toEqual([
      "mediaAssetInfo_v3",
    ]);
    expect(inspection.tables[0]?.columns.map((column) => column.name)).toEqual([
      "id",
      "view_offset",
      "created_at",
    ]);

    const report = await comparePaths(before, after);
    const semantic = report.files[0]?.semantic;
    const paths = semantic?.changes.map((change) => change.path) ?? [];
    expect(paths.some((entry) => entry.endsWith("view_offset"))).toBe(true);
    expect(paths.some((entry) => entry.endsWith("created_at"))).toBe(false);
    expect(semantic?.noise.some((hit) => hit.path.endsWith("created_at"))).toBe(
      true,
    );
  });
});

function writeDatabase(
  filePath: string,
  viewOffset: string,
  createdAt: string,
): void {
  const database = new DatabaseSync(filePath);
  database.exec(
    "CREATE TABLE mediaAssetInfo_v3 (id TEXT, view_offset TEXT, created_at TEXT)",
  );
  const statement = database.prepare(
    "INSERT INTO mediaAssetInfo_v3 (id, view_offset, created_at) VALUES (?, ?, ?)",
  );
  statement.run("clip-a", viewOffset, createdAt);
  database.close();
}
