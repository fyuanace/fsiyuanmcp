import { describe, expect, it } from "vitest";
import { FULLTEXT_HIT_THRESHOLD, MAX_SEARCH_LIMIT, searchNotes } from "../siyuan/search.js";

describe("searchNotes", () => {
  it("returns doc-name hits with full text when count is within threshold", async () => {
    const endpoints: string[] = [];
    const client = {
      post: async (endpoint: string) => {
        endpoints.push(endpoint);
        if (endpoint === "/api/filetree/searchDocs") {
          return [{ box: "A", path: "/20200101120000-docroot.sy", hPath: "/Inbox/a" }];
        }
        if (endpoint === "/api/search/fullTextSearchBlock") {
          throw new Error("should not search headings when doc-name hits exist");
        }
        if (endpoint === "/api/query/sql") {
          return [
            {
              id: "20200101120000-docroot",
              tag: "#work#",
              hpath: "/Inbox/a",
              content: "a",
              updated: "20260819120000",
              length: 20
            }
          ];
        }
        if (endpoint === "/api/export/exportMdContent") {
          return {
            hPath: "/Inbox/a",
            content:
              "---\n主要内容: hello 文档\n更新日期: 2026-08-19\n标签:\n  - work\n引用文档: []\n---\n\nhello body"
          };
        }
        return [];
      }
    };

    const result = await searchNotes(client as never, { query: "hello", expandGraph: false });
    expect(result.source).toBe("mixed");
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe("20200101120000-docroot");
    expect(result.data[0]?.sources).toEqual(["doc-name"]);
    expect(result.includeFullText).toBe(true);
    expect(result.data[0]?.markdown).toContain("hello body");
    expect(result.data[0]?.summary).toContain("hello");
    expect(endpoints).not.toContain("/api/search/fullTextSearchBlock");
  });

  it("falls back to heading search when doc-name search finds nothing", async () => {
    const endpoints: string[] = [];
    const client = {
      post: async (endpoint: string, body?: { types?: unknown }) => {
        endpoints.push(endpoint);
        if (endpoint === "/api/filetree/searchDocs") {
          return [];
        }
        if (endpoint === "/api/search/fullTextSearchBlock") {
          expect(body?.types).toEqual({ heading: true });
          return {
            blocks: [
              {
                id: "20200101120000-heading",
                box: "A",
                path: "/20200101120000-docroot.sy",
                hPath: "/Inbox/a",
                type: "h",
                content: "hello title"
              }
            ],
            matchedBlockCount: 1,
            pageCount: 1
          };
        }
        if (endpoint === "/api/query/sql") {
          return [
            {
              id: "20200101120000-docroot",
              tag: "#work#",
              hpath: "/Inbox/a",
              content: "a",
              updated: "20260819120000",
              length: 20
            }
          ];
        }
        if (endpoint === "/api/export/exportMdContent") {
          return {
            hPath: "/Inbox/a",
            content: "---\n主要内容: hello\n更新日期: 2026-08-19\n标签: []\n引用文档: []\n---\n\nhello body"
          };
        }
        return [];
      }
    };

    const result = await searchNotes(client as never, { query: "hello", expandGraph: false });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.sources).toEqual(["heading"]);
    expect(result.data[0]?.matches).toContain("hello title");
    expect(endpoints).toContain("/api/search/fullTextSearchBlock");
  });

  it("searches by tag via SQL", async () => {
    const statements: string[] = [];
    const client = {
      post: async (endpoint: string, body: { stmt?: string }) => {
        if (endpoint === "/api/query/sql") {
          statements.push(body.stmt ?? "");
          return [
            {
              id: "20200101120000-tagged",
              root_id: "20200101120000-docroot",
              box: "A",
              path: "/20200101120000-docroot.sy",
              hpath: "/Inbox/a",
              type: "d",
              content: "note",
              tag: "#work#"
            }
          ];
        }
        if (endpoint === "/api/export/exportMdContent") {
          return {
            content:
              "---\n主要内容: note\n更新日期: 2026-08-19\n标签:\n  - work\n引用文档: []\n---\n\nnote"
          };
        }
        return [];
      }
    };

    const result = await searchNotes(client as never, { tag: "work", expandGraph: false });
    expect(result.source).toBe("mixed");
    expect(result.data[0]?.source).toBe("tag");
    expect(result.data[0]?.matches).toContain("note");
    expect(statements.some((stmt) => stmt.includes("#work#"))).toBe(true);
  });

  it("returns none when nothing matched", async () => {
    const client = {
      post: async (endpoint: string) => {
        if (endpoint === "/api/filetree/searchDocs") {
          return [];
        }
        if (endpoint === "/api/search/fullTextSearchBlock") {
          return { blocks: [], matchedBlockCount: 0, pageCount: 0 };
        }
        return [];
      }
    };

    const result = await searchNotes(client as never, { keyword: "zzz" });
    expect(result.source).toBe("none");
    expect(result.message).toBe("没有搜到");
  });

  it("clamps oversized limit and skips full text above threshold", async () => {
    const docs = Array.from({ length: 20 }, (_, index) => {
      const id = `20200101120000-d${String(index).padStart(5, "0")}`;
      return { box: "A", path: `/${id}.sy`, hPath: `/Inbox/${id}` };
    });
    const client = {
      post: async (endpoint: string) => {
        if (endpoint === "/api/filetree/searchDocs") {
          return docs;
        }
        if (endpoint === "/api/search/fullTextSearchBlock") {
          throw new Error("should not search headings when doc-name hits exist");
        }
        if (endpoint === "/api/query/sql") {
          return [];
        }
        if (endpoint === "/api/export/exportMdContent") {
          return { content: "x", hPath: "/x" };
        }
        return [];
      }
    };

    const result = await searchNotes(client as never, { query: "hello", limit: 20, expandGraph: false });
    expect(result.data).toHaveLength(MAX_SEARCH_LIMIT);
    expect(result.includeFullText).toBe(false);
    expect(FULLTEXT_HIT_THRESHOLD).toBe(5);
  });
});
