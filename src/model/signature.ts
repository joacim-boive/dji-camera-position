import { crc32 } from "node:zlib";
import { endOfJsonValue } from "./json-span.js";

export type SignatureCheck = {
  hex: string;
  method: string;
  matches: boolean;
};

export function crc32Hex(text: string): string {
  return (crc32(Buffer.from(text, "utf8")) >>> 0).toString(16).padStart(8, "0");
}

export function inspectSignature(
  text: string,
  signature: unknown,
  method: unknown,
): SignatureCheck {
  const hex = typeof signature === "string" ? signature.toLowerCase() : "";
  const methodText = typeof method === "string" ? method : "";
  if (methodText !== "crc32" || !/^[0-9a-f]{8}$/.test(hex)) {
    return { hex, method: methodText, matches: false };
  }
  try {
    const data = dataValueSpan(text);
    return {
      hex,
      method: methodText,
      matches: crc32Hex(text.slice(data.start, data.end)) === hex,
    };
  } catch {
    return { hex, method: methodText, matches: false };
  }
}

export function readLeadingSignature(text: string): {
  start: number;
  end: number;
  hex: string;
} {
  const prefix = '{"signature":"';
  const hex = text.slice(prefix.length, prefix.length + 8);
  if (
    !text.startsWith(prefix) ||
    !/^[0-9a-fA-F]{8}$/.test(hex) ||
    text[prefix.length + 8] !== '"'
  ) {
    throw new Error(
      "Draft signature is not an 8-digit crc32 at the start of the file.",
    );
  }
  return {
    start: prefix.length,
    end: prefix.length + 8,
    hex: hex.toLowerCase(),
  };
}

export function dataValueSpan(text: string): { start: number; end: number } {
  const marker = '"data":';
  const at = text.indexOf(marker);
  if (at < 0) {
    throw new Error("Draft has no data field.");
  }
  const start = skipWhitespace(text, at + marker.length);
  return { start, end: endOfJsonValue(text, start) };
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") {
      return cursor;
    }
    cursor += 1;
  }
  throw new Error("Draft data value is missing.");
}
