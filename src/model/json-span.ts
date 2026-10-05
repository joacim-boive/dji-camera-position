export type TextSpan = {
  start: number;
  end: number;
};

export function endOfJsonValue(text: string, start: number): number {
  const ch = text[start];
  if (ch === undefined) {
    throw new Error("JSON value is missing.");
  }
  if (ch === '"') {
    return endOfJsonString(text, start);
  }
  if (ch === "{" || ch === "[") {
    return endOfContainer(text, start);
  }
  const match =
    /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
      text.slice(start),
    );
  if (match?.[0] === undefined) {
    throw new Error(`JSON value at index ${start} is not readable.`);
  }
  return start + match[0].length;
}

export function objectSpanContaining(text: string, index: number): TextSpan {
  const stack: number[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === '"') {
      cursor = endOfJsonString(text, cursor);
      continue;
    }
    if (ch === "{") {
      stack.push(cursor);
      cursor += 1;
      continue;
    }
    if (ch === "[") {
      stack.push(cursor);
      cursor += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      const start = stack.pop();
      if (start === undefined) {
        throw new Error("JSON is unbalanced.");
      }
      const end = cursor + 1;
      if (ch === "}" && index >= start && index < end) {
        return { start, end };
      }
      cursor = end;
      continue;
    }
    cursor += 1;
  }
  throw new Error("Could not locate the JSON object for that node.");
}

export function findObjectById(text: string, id: string): TextSpan {
  const needle = `"id":${JSON.stringify(id)}`;
  const at = text.indexOf(needle);
  if (at < 0) {
    throw new Error(`No node with id ${id}.`);
  }
  if (text.indexOf(needle, at + needle.length) !== -1) {
    throw new Error(`Node id ${id} appears more than once.`);
  }
  return objectSpanContaining(text, at);
}

export function keyValueSpan(
  text: string,
  objectSpan: TextSpan,
  key: string,
): TextSpan {
  const slice = text.slice(objectSpan.start, objectSpan.end);
  const marker = `"${key}":`;
  const local = slice.indexOf(marker);
  if (local < 0) {
    throw new Error(`Missing ${key}.`);
  }
  if (slice.indexOf(marker, local + marker.length) !== -1) {
    throw new Error(`Multiple ${key} fields in one node.`);
  }
  let start = objectSpan.start + local + marker.length;
  while (start < text.length) {
    const ch = text[start];
    if (ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") {
      break;
    }
    start += 1;
  }
  return { start, end: endOfJsonValue(text, start) };
}

export function applyEdits(
  text: string,
  edits: Array<TextSpan & { next: string }>,
): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let next = text;
  for (const edit of ordered) {
    next = next.slice(0, edit.start) + edit.next + next.slice(edit.end);
  }
  return next;
}

function endOfJsonString(text: string, start: number): number {
  if (text[start] !== '"') {
    throw new Error("Expected a JSON string.");
  }
  let cursor = start + 1;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === "\\") {
      cursor += 2;
      continue;
    }
    if (ch === '"') {
      return cursor + 1;
    }
    cursor += 1;
  }
  throw new Error("JSON string is not closed.");
}

function endOfContainer(text: string, start: number): number {
  let depth = 1;
  let cursor = start + 1;
  while (cursor < text.length && depth > 0) {
    const ch = text[cursor];
    if (ch === '"') {
      cursor = endOfJsonString(text, cursor);
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
    }
    cursor += 1;
  }
  if (depth !== 0) {
    throw new Error("JSON container is not closed.");
  }
  return cursor;
}
