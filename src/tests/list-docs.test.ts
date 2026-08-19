import { describe, expect, it } from "vitest";
import { listDocs } from "../siyuan/list-docs.js";
import { deleteDocs } from "../siyuan/delete-docs.js";

describe("listDocs", () => {
  it("lists top-level documents in a notebook", async () => {
    const client = {
      post: async (endpoint: string) => {
        if (endpoint === "/api/query/sql") {
          return [
            {
              id: "20200101120000-a",
              content: "笔记 A",
              hpath: "/笔记 A",
              path: "/20200101120000-a.sy",
              updated: "20260819120000",
              box: "nb1"
            },
            {
              id: "20200101120000-b",
              content: "笔记 B",
              hpath: "/笔记 B",
              path: "/20200101120000-b.sy",
              updated: "20260818120000",
              box: "nb1"
            }
          ];
        }
        return {};
      }
    };

    const result = await listDocs(client as never, {}, "nb1");
    expect(result.notebookId).toBe("nb1");
    expect(result.parentId).toBeNull();
    expect(result.writable).toBe(true);
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]?.title).toBe("笔记 A");
  });

  it("lists direct child documents under parentId", async () => {
    const client = {
      post: async (endpoint: string, body?: Record<string, unknown>) => {
        if (endpoint === "/api/block/getBlockInfo") {
          return { box: "nb2", path: "/20200101120000-parent.sy" };
        }
        if (endpoint === "/api/query/sql") {
          expect(String(body?.stmt)).toContain("20200101120000-parent/");
          return [
            {
              id: "20200101120000-child",
              content: "子文档",
              hpath: "/父/子文档",
              path: "/20200101120000-parent/20200101120000-child.sy",
              updated: "20260819120000",
              box: "nb2"
            }
          ];
        }
        return {};
      }
    };

    const result = await listDocs(client as never, { parentId: "20200101120000-parent" }, "nb1");
    expect(result.notebookId).toBe("nb2");
    expect(result.parentId).toBe("20200101120000-parent");
    expect(result.writable).toBe(false);
    expect(result.documents[0]?.title).toBe("子文档");
  });
});

describe("deleteDocs", () => {
  it("previews batch delete until confirm", async () => {
    const client = {
      post: async (endpoint: string) => {
        if (endpoint === "/api/block/getBlockInfo") {
          return { box: "nb1", rootTitle: "待删文档", hpath: "/待删文档", path: "/20200101120000-doc.sy" };
        }
        return {};
      }
    };

    const preview = await deleteDocs(client as never, { ids: ["20200101120000-doc"] }, "nb1");
    expect(preview.preview).toBe(true);
    expect(preview.deleted).toBe(false);
    expect(preview.targets).toHaveLength(1);

    const removed: string[] = [];
    const deletingClient = {
      post: async (endpoint: string, body?: Record<string, unknown>) => {
        if (endpoint === "/api/block/getBlockInfo") {
          return { box: "nb1", rootTitle: "待删文档", hpath: "/待删文档", path: "/20200101120000-doc.sy" };
        }
        if (endpoint === "/api/filetree/removeDocByID") {
          removed.push(String(body?.id));
          return { code: 0 };
        }
        return {};
      }
    };

    const result = await deleteDocs(deletingClient as never, { ids: ["20200101120000-doc"], confirm: true }, "nb1");
    expect(result.deleted).toBe(true);
    expect(result.deletedIds).toEqual(["20200101120000-doc"]);
    expect(removed).toEqual(["20200101120000-doc"]);
  });

  it("skips documents outside writable notebook", async () => {
    const client = {
      post: async (endpoint: string) => {
        if (endpoint === "/api/block/getBlockInfo") {
          return { box: "nb-readonly", rootTitle: "只读文档", hpath: "/只读文档", path: "/20200101120000-ro.sy" };
        }
        return {};
      }
    };

    const result = await deleteDocs(client as never, { ids: ["20200101120000-ro"], confirm: true }, "nb1");
    expect(result.deleted).toBe(false);
    expect(result.skipped[0]?.reason).toContain("只读");
  });

  it("rejects deleting notebook root", async () => {
    const result = await deleteDocs(
      { post: async () => ({}) } as never,
      { ids: ["20260623151531-iord87i"], confirm: true },
      "20260623151531-iord87i"
    );
    expect(result.skipped[0]?.reason).toContain("根文档");
  });
});
