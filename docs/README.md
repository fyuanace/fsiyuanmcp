# fsiyuanmcp

思源内核上的本地 HTTP MCP 服务：扁平长标题文档 + 标签/双链图谱，写操作限制在一个可写笔记本。

## 模块地图

| 模块 | 职责 | 入口 |
|------|------|------|
| MCP HTTP | JSON-RPC、tools/resources、附件代理 | `src/server.ts` |
| 工具目录 | 系统 / 记录 / 检索 / 维护 | `tool-catalog.json`、`src/mcp/catalog.ts` |
| Resources | 标签、笔记本（只读） | `src/mcp/resources.ts` |
| 记录 | `save_note` 扁平写入与同名更新 | `src/siyuan/save.ts` |
| 元数据 / 双链 | 文档头、`[[标题]]` ↔ 思源双链 | `src/siyuan/meta.ts`、`src/siyuan/wikilinks.ts` |
| 检索 | 关键字 + 图谱邻居；少命中带全文 | `src/siyuan/search.ts`、`src/siyuan/notes.ts` |
| 删除 | 默认删匹配块 | `src/siyuan/delete.ts` |
| 插件壳 | 设置页、自动启动、顶栏状态、前后端版本核对 | `index.js` |

## 整体架构

Agent 用长标题直接 `save_note`，无需分类。正文为标准 Markdown，引用写 `[[文档标题]]`。检索 `search_notes` 返回命中与邻居；命中少则附全文，命中多则只给元数据供二次筛选。读回永远是干净 Markdown。

详细方案见 `docs/design/2026-08-19-mcp-flat-note-graph.md`。
