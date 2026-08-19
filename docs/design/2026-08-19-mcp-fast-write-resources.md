---
type: design-change
project: fsiyuanmcp
module: mcp
date: 2026-08-19
status: superseded
summary: >
  已被扁平文档+图谱方案取代（见 2026-08-19-mcp-flat-note-graph.md）。本文件保留为历史。
related:
  - docs/design/2026-08-18-mcp-note-toolchain.md
  - docs/design/2026-08-19-mcp-flat-note-graph.md
tags: [mcp, resources, write, markdown]
---

# MCP 快速写入与 Resources 拆分

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-08-19 | superseded：扁平文档+图谱方案取代本方案 |
| 2026-08-19 | 新增 get_plugin_version 工具；initialize serverInfo.version 与 package.json 同步 |
| 2026-08-19 | 浏览类 list_* 改为 resources；create_doc 支持 major/minor/title 与默认 notebookId；read_note 返回干净 Markdown；三层路径校验 |

## 背景信息

Agent 写入前需多次 list 工具确认分类，耗时长；读回正文带思源 YAML/IAL；用户希望分类稳定为最多三层（大层级 / 小层级 / 内容），标题体现主题，确认位置后一次写入；Markdown 由插件转块存储；浏览能力适合 MCP resource 而非 tool。

## 当前方案

**Resources（只读浏览）**

- `siyuan://categories`：可写笔记本三层分类树，写入前读此资源选 major/minor
- `siyuan://tags`：已有标签（可选）
- `siyuan://notebooks`：笔记本列表与可写标记

**写入（一次 tool call）**

- `create_doc`：`major` + 可选 `minor` + `title` + `markdown`；`notebookId` 省略则使用插件配置的可写笔记本
- 路径最多三层，超出拒绝
- `markdown` 为标准 Markdown，经 `createDocWithMd` 转思源块；写入前去掉与 title 重复的 `# 标题` 行
- 不处理文档图标；标签仍可选写入

**读取**

- `read_note` 默认返回干净 Markdown（去 YAML front matter、文档级 H1、IAL、行尾双空格）
- `format=text` 时返回纯文本（`markdown` 字段亦为纯文本）

**工具面**

- 移除 `list_notebooks_readonly`、`list_docs_readonly`、`list_tags` 三个 tool
- 维护组块级工具保留；写操作仍校验可写笔记本

## 其他模块引用约束

- Agent 写入前先 `resources/read` → `siyuan://categories`，不要先调已删除的 list 工具
- 分类不要超过三层；`title` 应概括主题
- 读正文用 `read_note`，不要假设 export 原始格式

## 工程师测试验收方法

- `npm test`：major/minor/title 写入、三层拒绝、干净 Markdown 读回、resources/list 含 categories
- 手动：Cursor 重连 MCP 后 resources 可见；一次 create_doc 无 notebookId 可写入 agentbox

## 其他说明

- 需重启 MCP 服务或重载插件后 Cursor 才能看到新 tools/resources 列表
