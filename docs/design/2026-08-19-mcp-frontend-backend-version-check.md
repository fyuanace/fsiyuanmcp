---
type: design-change
project: fsiyuanmcp
module: mcp
date: 2026-08-19
status: implemented
summary: >
  思源设置页增加「读取后端版本」：HTTP GET /version 与 plugin.json 对照，确认 MCP 进程是否已加载新构建。
related:
  - docs/design/2026-08-19-mcp-flat-note-graph.md
tags: [mcp, version, settings-ui]
---

# 前后端版本核对

## 变更记录

| 时间 | 说明 |
|------|------|
| 2026-08-19 | 设置页按钮读取后端 `/version`，与前端 `plugin.json` 对照；`/healthz` 同步带出版本与 pid |

## 背景信息

插件壳（思源前端 `index.js`）与 MCP HTTP 后端（`dist/server.js` 子进程）是两套进程。改工具或发版后，常见情况是前端已加载新代码，但端口上仍是旧 Node 进程，Cursor 也仍缓存旧 tools/list。仅看「运行中」无法判断是否新构建。

## 当前方案

- 后端提供无鉴权 `GET /version`（以及增强后的 `/healthz`），返回 `version`、`pluginVersion`、`pid`
- 设置页「HTTP/HTTPS 连接」区增加「读取后端版本」：请求当前端口 `/version`，与本地 `plugin.json` 比较
- 一致：显示前端/后端版本与 pid；不一致或 404：提示仍是旧进程，建议「保存并重启」；无响应：提示未启动或端口不对

## 其他模块引用约束

- 版本核对走本机 HTTP，不经过 MCP Bearer；Agent 侧仍用 `get_plugin_version` tool
- 发版时同步 bump `package.json` 与 `plugin.json`，否则前后端永远「一致」却仍可能是旧逻辑

## 工程师测试验收方法

- `npm test`：`/version` 返回与 package 一致；设置页预览含前端/后端版本文案
- 手动：启动旧进程时点按钮应提示不一致或无 `/version`；「保存并重启」后再点应一致

## 其他说明

Cursor 仍需重连 MCP 才能刷新 tools 列表；本按钮只确认思源侧后端进程是否已换新。
