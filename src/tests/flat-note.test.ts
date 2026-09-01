import { describe, expect, it } from "vitest";
import { injectNoteMeta, parseNoteMeta, countDocSize } from "../siyuan/meta.js";
import { cleanExportedMarkdown } from "../siyuan/format.js";
import { siyuanRefsToWiki, wikiLinksToSiyuan } from "../siyuan/wikilinks.js";

describe("note meta", () => {
  it("injects and parses YAML frontmatter", () => {
    const { markdown, meta } = injectNoteMeta("正文段落", {
      summary: "主题说明",
      tags: ["qt"],
      refs: ["相关文档"],
      updated: "2026-08-19"
    });
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toContain("主要内容: 主题说明");
    expect(markdown).toContain("标签:");
    expect(markdown).toContain("- qt");
    expect(markdown).not.toContain("<!-- fsiyuanmcp-meta -->");
    expect(markdown).toContain("- 相关文档");
    expect(meta.tags).toContain("#qt#");
    const parsed = parseNoteMeta(markdown);
    expect(parsed.meta.summary).toBe("主题说明");
    expect(parsed.meta.tags).toContain("#qt#");
    expect(parsed.meta.refs).toContain("相关文档");
    expect(parsed.body).toContain("正文段落");
    expect(markdown).toMatch(/^---\n[\s\S]*?\n---\n\n正文段落/);
  });

  it("does not parse removed HTML comment meta", () => {
    const legacy = [
      "<!-- fsiyuanmcp-meta -->",
      "- 主要内容：旧格式",
      "<!-- /fsiyuanmcp-meta -->",
      "",
      "正文"
    ].join("\n");
    const parsed = parseNoteMeta(legacy);
    expect(parsed.meta.summary).toBe("");
    expect(parsed.body).toContain("<!-- fsiyuanmcp-meta -->");
  });

  it("keeps our frontmatter when cleaning SiYuan export YAML", () => {
    const raw = [
      "---",
      "title: 纪要",
      "---",
      "",
      "---",
      "主要内容: 会议",
      "更新日期: 2026-08-19",
      "标签:",
      "  - work",
      "引用文档: []",
      "---",
      "",
      "# 纪要",
      "",
      "段落"
    ].join("\n");
    const cleaned = cleanExportedMarkdown(raw, "纪要");
    expect(cleaned).toContain("主要内容: 会议");
    expect(cleaned).toContain("标签:");
    expect(cleaned).not.toContain("title: 纪要");
    expect(cleaned).toContain("段落");
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
