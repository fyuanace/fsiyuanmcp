---
type: design-change
project: fsiyuanmcp
module: mcp
date: 2026-08-18
status: implemented
summary: >
  把 MCP 收成记录与检索短链路：按分类写子文档并打标签，按正文或标签搜索后一次读出正文、双链和附件访问方式。
related: []
tags: [mcp, search, tags, backlinks, assets]
---

# 思源记录与检索短工具链

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-08-19 | `search_notes` 的 `limit` 在 tools/list 中声明 default/maximum；超出上限截断而不再 Zod 报错 |
| 2026-08-19 | 检索改为 grep 模式：按文档去重只返回命中片段，不默认导出全文；read_note 不再把 Markdown 标题当标签解析 |
| 2026-08-18 | 新增 search_notes / read_note / list_tags；create_doc 支持 parentPath+title+tags；附件走 MCP /assets 代理 |

## 背景信息

原先只能按文档名和标题块搜索，没有读正文工具，也无法按标签找回或带出双链/附件。记录侧虽能 create_doc，但没有按分类写成子文档、复用标签的明确约定。目标是让 Agent 用尽量短的调用链完成「写入正确分类、需要时检索并拿到相关内容」。

## 当前方案

记录链：`list_notebooks_readonly` → `list_docs_readonly` 选定父路径 → `list_tags` 复用标签 → `create_doc` 使用 `parentPath` + `title` + `markdown` + `tags` 调用 `createDocWithMd`。路径为人可读层级，例如 `/项目/会议/周报`。标签写入 Markdown `#tag#`，并尽量写入块属性。正文里的 `((id '锚文本'))` 由 Agent 直接写，不另增工具。

检索链对齐本地文件夹的 Grep + Read：`search_notes` 接受 `query`（兼容 `keyword`）和可选 `tag`。并行查文档名（`searchDocs`）与正文（`fullTextSearchBlock`，失败则 SQL），命中按文档去重（默认 8 篇，最大 12 篇；`tools/list` 用 JSON Schema 的 `default`/`maximum` 声明，超出截断而不是拒绝）。每篇只带路径、标题和最多 3 条命中片段，**不导出全文**。全文检索由思源内核索引完成，Agent 不必把每篇笔记读进上下文。确认某篇相关后再 `read_note(id)` 读这一篇。解析标签时只认 `#tag#` 或短属性列表，不再把 Markdown 标题的 `#` 当成空标签抛错。

维护仍保留删文档与块级增删改，不并进记录/检索主链。`search_limited` 仍可作为 `search_notes` 别名调用，但不再出现在工具清单里。

## 其他模块引用约束

- 写工具必须带可写 `notebookId`，跨笔记本拒绝。
- 创建子文档优先 `parentPath` + `title`，不要把存储路径 `*.sy` 当人类路径。
- 检索用 `search_notes` 的 `query` 拿路径与命中片段，不要假设片段等于全文；需要某篇正文再 `read_note(id)`。`limit` 默认 8、最大 12；Agent 传更大的值会被截断。
- 不要在工具结果里回传思源 Token；附件只给 MCP/思源 URL。
- 插件设置页的工具清单须与 `tool-catalog.json` 同步（`index.js` 内联副本）。

## 工程师测试验收方法

- `npm test`：检索按文档去重并返回命中片段、不调用 exportMd；`query` 与 `keyword` 均可；`limit` 超出最大值截断；标签 SQL 含 `#tag#`；`create_doc` 路径为 `/分类/标题` 且正文含标签；`read_note` 返回 markdown/tags/backlinks/assets，标题文档无标签不报错。
- 手动：用 `search_notes` 的 `query` 看到路径与片段；对其中一篇 `read_note` 能看到双链与图片 `mcpUrl`。
- 回归：未授权笔记本的 `create_doc` 仍失败；无 query/keyword/tag 的搜索被拒绝。

## 其他说明

块级编辑、删除仍走维护组工具。未实现上传本地文件到 `assets/`（需要时再加，避免拉长主链）。
