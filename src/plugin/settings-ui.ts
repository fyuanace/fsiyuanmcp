import type { NotebookInfo } from "../siyuan/contracts.js";
import type { McpResourceDescriptor } from "../mcp/catalog.js";
import type { McpToolDescriptor, ToolGroup } from "../mcp/tools.js";

export type SettingsViewModel = {
  mcpUrl: string;
  frontendVersion: string;
  backendVersion?: string;
  writableNotebookId: string;
  showTopbarStatus: boolean;
  autoStartOnBoot: boolean;
  autoStartDelayMs: number;
  notebooks: NotebookInfo[];
  toolGroups: ToolGroup[];
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  connectivityStatus: "unknown" | "ok" | "error";
  connectivityMessage?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderSettingsPage(vm: SettingsViewModel): string {
  const notebookOptions = vm.notebooks
    .map((notebook) => {
      const selected = notebook.id === vm.writableNotebookId ? " selected" : "";
      return `<option value="${escapeHtml(notebook.id)}"${selected}>${escapeHtml(notebook.name)} (${escapeHtml(notebook.id)})</option>`;
    })
    .join("");

  const groupsHtml = vm.toolGroups
    .map((group) => {
      const toolLines = group.tools
        .map((toolName) => {
          const tool = vm.tools.find((item) => item.name === toolName);
          return `<li><code>${escapeHtml(toolName)}</code> - ${escapeHtml(tool?.description ?? "")}</li>`;
        })
        .join("");
      return `<section><h3>${escapeHtml(group.group)}</h3><ul>${toolLines}</ul></section>`;
    })
    .join("");

  const resourcesHtml = (vm.resources ?? [])
    .map((resource) => `<li><code>${escapeHtml(resource.uri)}</code> - ${escapeHtml(resource.description)}</li>`)
    .join("");

  const statusText =
    vm.connectivityStatus === "ok"
      ? "连接正常"
      : vm.connectivityStatus === "error"
        ? `连接失败: ${vm.connectivityMessage ?? "未知错误"}`
        : "未检测";

  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        siyuanHttp: {
          url: vm.mcpUrl
        }
      }
    },
    null,
    2
  );

  return `
<div class="fn__flex-column" style="gap:12px">
  <section>
    <p style="margin:0;padding:10px 12px;border-radius:8px;border:1px solid #3573f0;background:rgba(53,115,240,0.12);line-height:1.55">
      本插件仅支持思源桌面端（Windows / macOS / Linux），不支持手机、平板等移动端。MCP 需在本机拉起 Node 服务供 Cursor 等客户端连接。
    </p>
  </section>
  <section>
    <h2>Agent 可写笔记本</h2>
    <label>可写 notebook</label>
    <select id="writableNotebookId">${notebookOptions}</select>
  </section>
  <section>
    <h2>MCP 服务地址</h2>
    <input id="mcpUrl" value="${escapeHtml(vm.mcpUrl)}" style="width:100%" />
    <div style="margin-top:6px">连通性：${escapeHtml(statusText)}</div>
    <div style="margin-top:6px">前端插件版本：${escapeHtml(vm.frontendVersion || "未知")}</div>
    <div>后端进程版本：${escapeHtml(vm.backendVersion || "未检测")}</div>
  </section>
  <section>
    <h2>启动与顶栏状态</h2>
    <label>
      <input type="checkbox" id="showTopbarStatus"${vm.showTopbarStatus ? " checked" : ""} />
      在顶栏显示 MCP 状态
    </label>
    <br />
    <label>
      <input type="checkbox" id="autoStartOnBoot"${vm.autoStartOnBoot ? " checked" : ""} />
      随思源启动自动拉起服务
    </label>
    <br />
    <label>自动启动延迟（毫秒，1000-2000）</label>
    <input id="autoStartDelayMs" value="${vm.autoStartDelayMs}" />
  </section>
  <section>
    <h2>MCP 工具总览（按功能）</h2>
    ${groupsHtml}
  </section>
  <section>
    <h2>MCP 资源</h2>
    <ul>${resourcesHtml}</ul>
  </section>
  <section>
    <h2>给 Cursor / Agent 的配置</h2>
    <pre>${escapeHtml(cursorConfig)}</pre>
  </section>
</div>
`.trim();
}
