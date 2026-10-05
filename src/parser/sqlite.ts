import { DatabaseSync } from "node:sqlite";

export type SqliteColumn = {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
};

export type SqliteTable = {
  name: string;
  columns: SqliteColumn[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
};

export type SqliteInspection = {
  tables: SqliteTable[];
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function inspectSqlite(
  filePath: string,
  sampleLimit = 5,
): SqliteInspection {
  const database = new DatabaseSync(filePath, {
    readOnly: true,
    readBigInts: true,
  });
  try {
    const tableRows = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const tables: SqliteTable[] = [];
    for (const row of asRows(tableRows)) {
      const name = row.name;
      if (typeof name !== "string") {
        continue;
      }
      const quoted = quoteIdent(name);
      const columns = database.prepare(`PRAGMA table_info(${quoted})`).all();
      const countRow = database
        .prepare(`SELECT COUNT(*) AS count FROM ${quoted}`)
        .get();
      const sample = database
        .prepare(`SELECT * FROM ${quoted} LIMIT ${sampleLimit}`)
        .all();
      tables.push({
        name,
        columns: asRows(columns).map(readColumn),
        rowCount: readCount(countRow),
        sampleRows: asRows(sample).map(normalizeRow),
      });
    }
    return { tables };
  } finally {
    database.close();
  }
}

export function sqliteToJson(
  filePath: string,
  rowLimit = 5000,
): Record<string, unknown> {
  const database = new DatabaseSync(filePath, {
    readOnly: true,
    readBigInts: true,
  });
  try {
    const tableRows = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const tables: Record<string, unknown> = {};
    for (const row of asRows(tableRows)) {
      const name = row.name;
      if (typeof name !== "string") {
        continue;
      }
      const quoted = quoteIdent(name);
      const countRow = database
        .prepare(`SELECT COUNT(*) AS count FROM ${quoted}`)
        .get();
      const count = readCount(countRow);
      if (count > rowLimit) {
        tables[name] = { truncated: true, rowCount: count };
        continue;
      }
      const rows = database
        .prepare(`SELECT rowid AS _rowid, * FROM ${quoted} ORDER BY rowid`)
        .all();
      tables[name] = asRows(rows).map(normalizeRow);
    }
    return { tables };
  } finally {
    database.close();
  }
}

function quoteIdent(name: string): string {
  if (IDENTIFIER.test(name)) {
    return `"${name}"`;
  }
  return `"${name.replaceAll('"', '""')}"`;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

function readColumn(row: Record<string, unknown>): SqliteColumn {
  return {
    name: typeof row.name === "string" ? row.name : String(row.name),
    type: typeof row.type === "string" ? row.type : "",
    notNull: Number(row.notnull) === 1,
    primaryKey: Number(row.pk) === 1,
  };
}

function readCount(row: unknown): number {
  if (typeof row !== "object" || row === null || !("count" in row)) {
    return 0;
  }
  const count = normalizeSqlValue(row.count);
  return typeof count === "number" ? count : 0;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeSqlValue(value);
  }
  return normalized;
}

function normalizeSqlValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Uint8Array) {
    return `bytes(${value.byteLength})`;
  }
  return value;
}
