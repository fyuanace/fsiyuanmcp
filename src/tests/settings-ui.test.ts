import { describe, expect, it } from "vitest";
import { renderSettingsPage } from "../plugin/settings-ui.js";

describe("renderSettingsPage", () => {
  it("renders grouped tools and cursor config", () => {
    const html = renderSettingsPage({
      mcpUrl: "http://127.0.0.1:3900/mcp",
      frontendVersion: "0.4.2",
      backendVersion: "0.4.2",
      writableNotebookId: "nb1",
      showTopbarStatus: true,
      autoStartOnBoot: true,
      autoStartDelayMs: 1500,
      notebooks: [{ id: "nb1", name: "Inbox" }],
      toolGroups: [{ group: "检索", tools: ["search_notes"] }],
      tools: [
        {
          name: "search_notes",
          description: "desc",
          inputSchema: {},
          group: "检索"
        }
      ],
      resources: [{ uri: "siyuan://tags", name: "tags", description: "标签", mimeType: "application/json" }],
      connectivityStatus: "ok"
    });

    expect(html).toContain("Agent 可写笔记本");
    expect(html).toContain("仅支持思源桌面端");
    expect(html).toContain("search_notes");
    expect(html).toContain("siyuan://tags");
    expect(html).toContain("&quot;mcpServers&quot;");
    expect(html).toContain("在顶栏显示 MCP 状态");
    expect(html).toContain("前端插件版本：0.4.2");
    expect(html).toContain("后端进程版本：0.4.2");
  });
});
