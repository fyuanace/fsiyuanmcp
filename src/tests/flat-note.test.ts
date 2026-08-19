import { describe, expect, it } from "vitest";
import { injectNoteMeta, parseNoteMeta, countDocSize } from "../siyuan/meta.js";
import { siyuanRefsToWiki, wikiLinksToSiyuan } from "../siyuan/wikilinks.js";

describe("note meta", () => {
  it("injects and parses metadata header", () => {
    const { markdown, meta } = injectNoteMeta("正文段落", {
      summary: "主题说明",
      tags: ["qt"],
      refs: ["相关文档"],
      updated: "2026-08-19"
    });
    expect(markdown).toContain("主要内容：主题说明");
    expect(markdown).toContain("#qt#");
    expect(markdown).toContain("[[相关文档]]");
    const parsed = parseNoteMeta(markdown);
    expect(parsed.meta.summary).toBe("主题说明");
    expect(parsed.meta.tags).toContain("#qt#");
    expect(parsed.body).toContain("正文段落");
  });

  it("flags large documents", () => {
    const big = "字".repeat(9000);
    expect(countDocSize(big).tooLarge).toBe(true);
  });
});

describe("wiki links", () => {
  it("converts [[title]] to siyuan refs when resolvable", async () => {
    const result = await wikiLinksToSiyuan("见 [[目标A]] 与 [[缺失]]", async (title) =>
      title === "目标A" ? "20200101120000-aaaaaa" : null
    );
    expect(result.markdown).toContain("((20200101120000-aaaaaa '目标A'))");
    expect(result.markdown).toContain("[[缺失]]");
    expect(result.unresolvedRefs).toEqual(["缺失"]);
  });

  it("restores [[title]] from siyuan refs", () => {
    const text = siyuanRefsToWiki("链接 ((20200101120000-aaaaaa '目标A'))", {
      "20200101120000-aaaaaa": "目标A"
    });
    expect(text).toContain("[[目标A]]");
  });
});
