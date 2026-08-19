import { describe, expect, it } from "vitest";
import {
  ensureMarkdownTags,
  joinHPath,
  normalizeTag,
  parseTagField,
  resolveCreateDocPath
} from "../siyuan/format.js";
import { extractAssets } from "../siyuan/notes.js";

describe("format helpers", () => {
  it("builds child document path under a category", () => {
    expect(joinHPath("/项目/会议", "周报")).toBe("/项目/会议/周报");
    expect(resolveCreateDocPath({ parentPath: "/Inbox", title: "a/b" })).toBe("/Inbox/a-b");
  });

  it("normalizes tags and injects them into markdown", () => {
    expect(normalizeTag("work")).toBe("#work#");
    expect(parseTagField("#home# #work#")).toEqual(["#home#", "#work#"]);
    expect(parseTagField("work,inbox")).toEqual(["#work#", "#inbox#"]);
    expect(parseTagField("# Title\n\nbody")).toEqual([]);
    expect(parseTagField("#")).toEqual([]);
    expect(ensureMarkdownTags("hello", ["#work#"])).toContain("#work#");
  });
});

describe("extractAssets", () => {
  it("extracts image and file assets from markdown", () => {
    const assets = extractAssets("see ![](assets/pic.png) and [file](assets/note.pdf)");
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      kind: "image",
      src: "assets/pic.png"
    });
    expect(assets[1]?.kind).toBe("file");
  });
});
