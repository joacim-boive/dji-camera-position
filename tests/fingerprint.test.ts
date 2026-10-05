import { describe, expect, it } from "vitest";
import { parseJsonText } from "../src/json.js";
import { detectEnvelope } from "../src/parser/envelope.js";
import { structuralFingerprint } from "../src/parser/fingerprint.js";

describe("structural fingerprint", () => {
  it("ignores numeric values and changes when a key appears", () => {
    const first = structuralFingerprint({ view_offset: [0, 0, 0, 60, 1] });
    const second = structuralFingerprint({ view_offset: [1, 2, 3, 70, 1] });
    const third = structuralFingerprint({
      view_offset: [0, 0, 0, 60, 1],
      extra: true,
    });
    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("includes __type__ strings so node kinds affect the fingerprint", () => {
    const view = structuralFingerprint({
      __type__: "PanoramaViewData",
      view_offset: [0, 0, 0, 0, 0],
    });
    const filter = structuralFingerprint({
      __type__: "PanoramaFilter",
      view_offset: [0, 0, 0, 0, 0],
    });
    expect(view).not.toBe(filter);
  });
});

describe("envelope detection", () => {
  it("reports a signature wrapper without dropping unknown keys on parse", () => {
    const text =
      '{"signature":"ab","signature_method":"crc32","data":{"nodes":[]},"future_field":1}';
    const parsed = parseJsonText(text);
    const envelope = detectEnvelope(parsed);
    expect(envelope.isEnvelope).toBe(true);
    expect(envelope.signatureMethod).toBe("crc32");
    expect(envelope.extraKeys).toEqual(["future_field"]);
    expect(JSON.parse(JSON.stringify(parsed))).toMatchObject({
      future_field: 1,
      data: { nodes: [] },
    });
  });
});
