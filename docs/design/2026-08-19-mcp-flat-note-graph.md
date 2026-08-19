---
type: design-change
project: fsiyuanmcp
module: mcp
date: 2026-08-19
status: implemented
summary: >
  取消分类：扁平长标题文档、顶部元数据、[[标题]] 双链图谱；工具收成 save_note / search_notes / read_note / delete_content。
related:
  - docs/design/2026-08-19-mcp-fast-write-resources.md
  - docs/design/2026-08-19-mcp-frontend-backend-version-check.md
tags: [mcp, flat-note, graph, wikilink]
---

# 扁平文档 + 图谱 MCP

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-08-19 | 落地：save_note、元数据头、wiki 双链、检索图谱扩展、delete_content；移除分类与块级工具 |
| 2026-08-19 | 设置页可核对前后端版本（见 frontend-backend-version-check） |

## 背景信息

检索走思源全文索引，不需要文件夹分类。目标是 Agent 用熟悉的 Markdown 与 `[[标题]]` 读写，用标签和引用形成轻量知识图谱，并控制删除与大文档分流。

## 当前方案

**文档模型**

- 路径：`/很长的主题标题`（可写笔记本根下）
- 顶部元数据（MCP 维护）：主要内容、更新日期、标签、引用文档
- Agent 写 `[[标题]]`；写入前转 `((id '标题'))`；读回还原 `[[标题]]`
- `charCount` 约 ≥12000 或汉字约 ≥8000 时 `tooLarge=true`，提示另建文档互链

**工具**

- `save_note`：同名更新保留 id；新名创建
- `search_notes`：命中 + 同标签/双链邻居；合计 ≤2 带全文，否则只给元数据
- `read_note`：干净 Markdown
- `delete_content`：默认删匹配块；整篇需 `scope=document` + `confirm=true`
- `get_plugin_version`

**Resources**

- `siyuan://tags`、`siyuan://notebooks`（无 categories）

## 其他模块引用约束

- 不要传 major/minor/parentPath；不要假设分类树存在
- 引用只用 `[[标题]]`，不解到的标题会进 `unresolvedRefs`，不自动建空文档
- 删整篇必须显式确认

## 工程师测试验收方法

- `npm test`：wiki/meta、save_note、search 少命中全文、delete 预览、resources 无 categories
- 手动：重连 MCP 后仅见新工具；save 同名更新 id 不变；read 见 `[[标题]]`

## 其他说明

旧 `create_doc` 调用仍映射到 `save_note`（兼容短时）。块级维护工具已从清单移除。
