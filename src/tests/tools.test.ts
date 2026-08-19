import { describe, expect, it } from "vitest";
import { McpToolsService } from "../mcp/tools.js";
import { McpResourcesService } from "../mcp/resources.js";
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from "../siyuan/search.js";

describe("McpToolsService flat note loop", () => {
  it("returns plugin version without touching SiYuan APIs", async () => {
    const client = {
      baseUrl: "http://127.0.0.1:6806",
      post: async () => {
        throw new Error("should not call SiYuan API");
      }
    };
    const service = new McpToolsService(client as never, {
      writableNotebookId: "nb1",
      mcpBaseUrl: "http://127.0.0.1:3900",
      siyuanBaseUrl: "http://127.0.0.1:6806"
    });
    const result = (await service.callTool("get_plugin_version", {})) as {
      data: { version: string; pluginVersion: string; name: string };
    };
    expect(result.data.name).toBe("fsiyuanmcp");
    expect(result.data.version).toBe(result.data.pluginVersion);
  });

  it("saves a flat note with meta and wiki links", async () => {
    const calls: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
    const client = {
      baseUrl: "http://127.0.0.1:6806",
      post: async (endpoint: string, body: Record<string, unknown>) => {
        calls.push({ endpoint, body });
        if (endpoint === "/api/filetree/getIDsByHPath") {
          if (body.path === "/被引用文档") {
            return ["20200101120000-refdoc"];
          }
          return [];
        }
        if (endpoint === "/api/query/sql") {
          return [];
        }
        if (endpoint === "/api/filetree/createDocWithMd") {
          return "20200101120000-newdoc";
        }
        return {};
      }
    };

    const service = new McpToolsService(client as never, {
      writableNotebookId: "nb1",
      mcpBaseUrl: "http://127.0.0.1:3900",
      siyuanBaseUrl: "http://127.0.0.1:6806"
    });

    const result = (await service.callTool("save_note", {
      title: "QCustomPlot 真 1px 水平线绘制做法",
      summary: "cosmetic pen 与像素对齐",
      markdown: "详见 [[被引用文档]]\n\n正文",
      tags: ["qt"],
      refs: ["被引用文档"]
    })) as {
      data: {
        path: string;
        created: boolean;
        unresolvedRefs: string[];
        meta: { tags: string[]; refs: string[]; summary: string };
      };
    };

    expect(result.data.created).toBe(true);
    expect(result.data.path).toBe("/QCustomPlot 真 1px 水平线绘制做法");
    expect(result.data.meta.summary).toContain("cosmetic");
    expect(result.data.meta.tags).toContain("#qt#");
    expect(result.data.meta.refs).toContain("被引用文档");
    const createCall = calls.find((item) => item.endpoint === "/api/filetree/createDocWithMd");
    expect(String(createCall?.body.markdown)).toContain("((20200101120000-refdoc");
    expect(String(createCall?.body.markdown)).toContain("主要内容");
  });

  it("reads clean markdown with wiki links restored", async () => {
    const client = {
      baseUrl: "http://127.0.0.1:6806",
      post: async (endpoint: string) => {
        if (endpoint === "/api/block/getBlockInfo") {
          return {
            box: "nb1",
            path: "/20200101120000-doc.sy",
            rootID: "20200101120000-docid",
            rootTitle: "纪要"
          };
        }
        if (endpoint === "/api/export/exportMdContent") {
          return {
            hPath: "/纪要",
            content:
              "---\ntitle: 纪要\n---\n\n# 纪要\n\n<!-- fsiyuanmcp-meta -->\n- 主要内容：会议\n- 更新日期：2026-08-19\n- 标签：#work#\n- 引用文档：[[目标]]\n<!-- /fsiyuanmcp-meta -->\n\n见 ((20200101120000-target '目标')) 与 ![](assets/pic.png)"
          };
        }
        if (endpoint === "/api/query/sql") {
          return [
            {
              id: "20200101120000-target",
              content: "目标",
              hpath: "/目标",
              tag: "#work#",
              hpath2: "/纪要",
              box: "nb1",
              path: "/20200101120000-doc.sy",
              block_id: "20200101120000-link",
              def_block_id: "20200101120000-target"
            }
          ];
        }
        if (endpoint === "/api/asset/getDocImageAssets") {
          return ["assets/pic.png"];
        }
        return {};
      }
    };

    const service = new McpToolsService(client as never, {
      writableNotebookId: "nb1",
      mcpBaseUrl: "http://127.0.0.1:3900",
      siyuanBaseUrl: "http://127.0.0.1:6806"
    });

    const result = (await service.callTool("read_note", { id: "20200101120000-docid" })) as {
      data: { markdown: string; tags: string[]; summary: string; refs: string[]; assets: Array<{ src: string }> };
    };
    expect(result.data.markdown).not.toContain("---");
    expect(result.data.markdown).toContain("[[目标]]");
    expect(result.data.summary).toBe("会议");
    expect(result.data.tags).toContain("#work#");
    expect(result.data.assets[0]?.src).toBe("assets/pic.png");
  });

  it("search_notes accepts query and returns snippets without requiring categories", async () => {
    const endpoints: string[] = [];
    const client = {
      baseUrl: "http://127.0.0.1:6806",
      post: async (endpoint: string) => {
        endpoints.push(endpoint);
        if (endpoint === "/api/filetree/searchDocs") {
          return [{ box: "nb1", path: "/20200101120000-docid.sy", hPath: "/项目纪要" }];
        }
        if (endpoint === "/api/search/fullTextSearchBlock") {
          return {
            blocks: [
              {
                id: "20200101120000-p",
                box: "nb1",
                path: "/20200101120000-docid.sy",
                hPath: "/项目纪要",
                type: "p",
                content: "会议内容"
              }
            ],
            matchedBlockCount: 1,
            pageCount: 1
          };
        }
        if (endpoint === "/api/query/sql") {
          return [
            {
              id: "20200101120000-docid",
              tag: "#work#",
              hpath: "/项目纪要",
              content: "项目纪要",
              updated: "20260819120000",
              length: 100
            }
          ];
        }
        if (endpoint === "/api/export/exportMdContent") {
          return {
            hPath: "/项目纪要",
            content:
              "<!-- fsiyuanmcp-meta -->\n- 主要内容：会议纪要\n- 更新日期：2026-08-19\n- 标签：#work#\n- 引用文档：\n<!-- /fsiyuanmcp-meta -->\n\n会议内容"
          };
        }
        return [];
      }
    };

    const service = new McpToolsService(client as never, {
      writableNotebookId: "nb1",
      mcpBaseUrl: "http://127.0.0.1:3900",
      siyuanBaseUrl: "http://127.0.0.1:6806"
    });

    const result = (await service.callTool("search_notes", { query: "纪要" })) as {
      data: Array<{ snippet: string; matches: string[]; summary?: string; markdown?: string }>;
      includeFullText: boolean;
    };
    expect(result.data[0]?.matches?.length || result.data[0]?.snippet).toBeTruthy();
    expect(result.includeFullText).toBe(true);
    expect(endpoints).not.toContain("/api/filetree/listDocsByPath");
  });

  it("advertises search_notes limit bounds and accepts oversized limit", async () => {
    const docs = Array.from({ length: 20 }, (_, index) => {
      const id = `20200101120000-d${String(index).padStart(5, "0")}`;
      return { box: "nb1", path: `/${id}.sy`, hPath: `/${id}` };
    });
    const client = {
      baseUrl: "http://127.0.0.1:6806",
      post: async (endpoint: string) => {
        if (endpoint === "/api/filetree/searchDocs") {
          return docs;
        }
        if (endpoint === "/api/search/fullTextSearchBlock") {
          return { blocks: [], matchedBlockCount: 0, pageCount: 0 };
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
    const service = new McpToolsService(client as never, {
      writableNotebookId: "nb1",
      mcpBaseUrl: "http://127.0.0.1:3900",
      siyuanBaseUrl: "http://127.0.0.1:6806"
    });

    const searchTool = service.listTools().find((tool) => tool.name === "search_notes");
    const limitSchema = (
      searchTool?.inputSchema as {
        properties?: { limit?: { default?: number; maximum?: number; minimum?: number; type?: string } };
      }
    )?.properties?.limit;
    expect(limitSchema).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: MAX_SEARCH_LIMIT,
      default: DEFAULT_SEARCH_LIMIT
    });

    const result = (await service.callTool("search_notes", { query: "项目", limit: 20 })) as {
      data: unknown[];
    };
    expect(result.data).toHaveLength(MAX_SEARCH_LIMIT);
  });

  it("delete_content previews document deletes until confirm", async () => {
    const client = {
      baseUrl: "http://127.0.0.1:6806",
      post: async (endpoint: string) => {
        if (endpoint === "/api/query/sql") {
          return [
            {
              id: "20200101120000-docid",
              root_id: "20200101120000-docid",
              box: "nb1",
              path: "/20200101120000-docid.sy",
              hpath: "/旧笔记",
              type: "d",
              content: "旧笔记"
            }
          ];
        }
        return {};
      }
    };
    const service = new McpToolsService(client as never, {
      writableNotebookId: "nb1",
      mcpBaseUrl: "http://127.0.0.1:3900",
      siyuanBaseUrl: "http://127.0.0.1:6806"
    });
    const preview = (await service.callTool("delete_content", {
      query: "旧笔记",
      scope: "document"
    })) as { data: { deleted: boolean; preview: boolean } };
    expect(preview.data.preview).toBe(true);
    expect(preview.data.deleted).toBe(false);
  });
});

describe("McpResourcesService", () => {
  it("lists tags resource and rejects removed categories", async () => {
    const client = {
      post: async (endpoint: string) => {
        if (endpoint === "/api/notebook/lsNotebooks") {
          return { notebooks: [{ id: "nb1", name: "agentbox" }] };
        }
        if (endpoint === "/api/tag/getTag") {
          return [{ name: "work", count: 1 }];
        }
        return {};
      }
    };
    const service = new McpResourcesService(client as never, "nb1");
    expect(service.listResources().some((item) => item.uri === "siyuan://tags")).toBe(true);
    expect(service.listResources().some((item) => item.uri === "siyuan://categories")).toBe(false);
    await expect(service.readResource("siyuan://categories")).rejects.toThrow(/Unknown resource/);
    const contents = await service.readResource("siyuan://tags");
    expect(contents.mimeType).toBe("application/json");
  });
});
