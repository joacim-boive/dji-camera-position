import { isPlainObject } from "../json.js";
import { hypothesize, numberShape, type Hypothesis } from "./hypotheses.js";
import { noiseReason, type NoiseReason } from "./noise.js";

const MISSING = Symbol("missing");

export type DiffChange = {
  kind: "changed" | "added" | "removed";
  path: string;
  before?: unknown;
  after?: unknown;
  hypothesis?: Hypothesis;
  shape?: string;
};

export type NoiseHit = {
  path: string;
  reason: NoiseReason;
};

export type SemanticDiff = {
  changes: DiffChange[];
  noise: NoiseHit[];
};

export type DiffOptions = {
  includeNoise?: boolean;
};

export function diffValues(
  before: unknown,
  after: unknown,
  options: DiffOptions = {},
): SemanticDiff {
  const changes: DiffChange[] = [];
  const noise: NoiseHit[] = [];
  walk(before, after, "$", changes, noise, options.includeNoise === true);
  changes.sort(compareChanges);
  noise.sort((left, right) => left.path.localeCompare(right.path));
  return { changes, noise };
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  changes: DiffChange[],
  noise: NoiseHit[],
  includeNoise: boolean,
): void {
  if (deepEqual(before, after)) {
    return;
  }

  const reason = noiseReason(path, before, after);
  if (reason !== undefined && path !== "$" && !includeNoise) {
    noise.push({ path, reason });
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    for (const key of keys) {
      const next = path === "$" ? key : `${path}.${key}`;
      const left = Object.prototype.hasOwnProperty.call(before, key)
        ? before[key]
        : MISSING;
      const right = Object.prototype.hasOwnProperty.call(after, key)
        ? after[key]
        : MISSING;
      if (left === MISSING && right !== MISSING) {
        pushStructural(changes, "added", next, undefined, right);
        continue;
      }
      if (right === MISSING && left !== MISSING) {
        pushStructural(changes, "removed", next, left, undefined);
        continue;
      }
      if (left !== MISSING && right !== MISSING) {
        walk(left, right, next, changes, noise, includeNoise);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const next = `${path}[${index}]`;
      if (index >= before.length) {
        pushStructural(changes, "added", next, undefined, after[index]);
        continue;
      }
      if (index >= after.length) {
        pushStructural(changes, "removed", next, before[index], undefined);
        continue;
      }
      walk(before[index], after[index], next, changes, noise, includeNoise);
    }
    return;
  }

  const hypothesis = hypothesize(path, before, after);
  const shape = shapeNote(before, after);
  changes.push({
    kind: "changed",
    path,
    before,
    after,
    ...(hypothesis === undefined ? {} : { hypothesis }),
    ...(shape === undefined ? {} : { shape }),
  });
}

function pushStructural(
  changes: DiffChange[],
  kind: "added" | "removed",
  path: string,
  before: unknown,
  after: unknown,
): void {
  changes.push({
    kind,
    path,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  });
}

function shapeNote(before: unknown, after: unknown): string | undefined {
  const parts: string[] = [];
  const beforeShape = numberShape(before);
  const afterShape = numberShape(after);
  if (beforeShape !== undefined) {
    parts.push(`before ${beforeShape}`);
  }
  if (afterShape !== undefined) {
    parts.push(`after ${afterShape}`);
  }
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function compareChanges(left: DiffChange, right: DiffChange): number {
  const rank = { changed: 0, added: 1, removed: 2 };
  const byKind = rank[left.kind] - rank[right.kind];
  if (byKind !== 0) {
    return byKind;
  }
  return left.path.localeCompare(right.path);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        deepEqual(left[key], right[key]),
    );
  }
  return false;
}
