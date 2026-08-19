import { describe, expect, it } from "vitest";
import { buildCategoryTree } from "../siyuan/categories.js";
import {
  assertHPathDepth,
  cleanExportedMarkdown,
  markdownToPlainText,
  resolveCreateDocPath,
  stripLeadingTitleHeading
} from "../siyuan/format.js";

describe("category tree", () => {
  it("builds three-level tree from hpaths", () => {
    const tree = buildCategoryTree([
      { id: "d1", hpath: "/study/qt/1px" },
      { id: "d2", hpath: "/study/qt/color" },
      { id: "d3", hpath: "/inbox" }
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.name).toBe("study");
    expect(tree[0]?.children[0]?.name).toBe("qt");
    expect(tree[0]?.children[0]?.children).toHaveLength(2);
    expect(tree[1]?.kind).toBe("content");
  });
});

describe("format helpers", () => {
  it("resolves major/minor/title path", () => {
    expect(resolveCreateDocPath({ major: "study", minor: "qt", title: "1px" })).toBe("/study/qt/1px");
    expect(resolveCreateDocPath({ major: "inbox", title: "memo" })).toBe("/inbox/memo");
  });

  it("rejects deeper than three levels", () => {
    expect(() => resolveCreateDocPath({ path: "/a/b/c/d" })).toThrow("最多三层");
    expect(assertHPathDepth("/a/b/c")).toBe("/a/b/c");
  });

  it("strips duplicate title heading before write", () => {
    expect(stripLeadingTitleHeading("# 标题\n\n正文", "标题")).toBe("正文");
  });

  it("cleans exported markdown for agents", () => {
    const raw = "---\ntitle: x\ntags:\n  - a\n---\n\n# 标题\n\n段落  \n\n#tag#";
    expect(cleanExportedMarkdown(raw, "标题")).toBe("段落\n\n#tag#");
    expect(markdownToPlainText("**加粗** 与 #tag#")).toContain("加粗");
  });
});
