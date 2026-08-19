# 变更记录

| 时间 | 说明 |
|------|------|
| 2026-08-19 | 设置页增加「读取后端版本」；`GET /version` 与 `/healthz` 返回版本与 pid；版本号 0.4.2 |
| 2026-08-19 | 版本号调整为 0.4.1，便于确认 MCP 进程已加载新构建 |
| 2026-08-19 | 扁平文档+图谱：save_note、[[标题]] 双链、元数据头、检索扩展、delete_content；移除分类与块级工具 |
| 2026-08-19 | 新增 get_plugin_version 工具；initialize 的 serverInfo.version 与 package.json 同步 |
| 2026-08-19 | 快速写入：三层分类 resource、一次 create_doc、干净 Markdown 读回；list_* 改为 resources |
| 2026-08-19 | 检索改为 grep 模式：只返回去重文档与命中片段；修复 `read_note` 把标题 `#` 当成空标签 |
| 2026-08-18 | 记录/检索短链路落地：子文档分类写入、正文与标签检索、一次读取双链与附件 |
| 2026-08-18 | Cursor Streamable HTTP：补 GET /mcp SSE、initialized 返回 202；本地 HTTPS 内核不再因证书校验失败而无法握手 |
| 2026-08-18 | 集市已下载列表改为不透明 RGB `icon.png`（160×160），并补 `preview.png`；插件加载时刷新图标缓存 |
