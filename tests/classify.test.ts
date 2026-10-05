import { describe, expect, it } from "vitest";
import { classifyBuffer } from "../src/parser/classify.js";

describe("classifyBuffer", () => {
  it("recognizes SQLite, bookmarks, plist, and JSON from headers", () => {
    expect(classifyBuffer(Buffer.from("SQLite format 3\0"), "proj.db")).toBe(
      "sqlite",
    );
    expect(classifyBuffer(Buffer.from("book\0\0\0\0"), "clip.bookmark")).toBe(
      "macos-bookmark",
    );
    expect(classifyBuffer(Buffer.from("bplist00"), "Info.plist")).toBe(
      "plist-binary",
    );
    expect(
      classifyBuffer(
        Buffer.from('<?xml version="1.0"?><plist version="1.0"></plist>'),
        "Info.plist",
      ),
    ).toBe("plist-xml");
    expect(
      classifyBuffer(Buffer.from('{"signature":"ab"}'), "draft.json"),
    ).toBe("json");
  });

  it("does not call a protobuf extension a decoded schema", () => {
    expect(
      classifyBuffer(Buffer.from([0x0a, 0x02, 0x68, 0x69]), "model.pb"),
    ).toBe("protobuf-extension");
  });

  it("treats key=value text as ini", () => {
    expect(
      classifyBuffer(
        Buffer.from("method=json\nversion=1.1.0\n"),
        "project.meta",
      ),
    ).toBe("ini");
  });

  it("does not treat an INI section header as a JSON array", () => {
    expect(
      classifyBuffer(Buffer.from("[General]\nname=value\n"), "config.ini"),
    ).toBe("ini");
    expect(classifyBuffer(Buffer.from("[1, 2, 3]"), "values.json")).toBe(
      "json",
    );
  });
});
