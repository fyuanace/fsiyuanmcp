# 变更记录

| 时间 | 说明 |
|------|------|
| 2026-09-03 | 限定仅桌面端启用（plugin.json backends/frontends + 运行时检测）；说明写入 README 与设置页 |
| 2026-09-01 | 移除 HTML 注释元数据兼容；frontmatter 与正文之间固定空一行 |
| 2026-09-01 | 元数据改为 YAML frontmatter；禁止写入思源文档属性（不再 setBlockAttrs） |
| 2026-08-19 | read_note 正文末尾附附件本地路径；移除 siyuan://asset Resource 与 HTTP /assets 代理 |
| 2026-08-19 | read_note 附件增加 localPath/resourceUri；新增 siyuan://asset 与 siyuan://doc/{id}/assets Resource |
| 2026-08-19 | search_notes 改为两轮（文档名→标题块），命中≤5 附全文，不再搜正文段落 |
| 2026-08-19 | 新增 list_docs / delete_docs；读写权限：全库只读浏览，仅可写笔记本可 save/delete |
| 2026-08-19 | 设置页增加「读取后端版本」；`GET /version` 与 `/healthz` 返回版本与 pid；版本号 0.4.2 |
| 2026-08-19 | 版本号调整为 0.4.1，便于确认 MCP 进程已加载新构建 |
| 2026-08-19 | 扁平文档+图谱：save_note、[[标题]] 双链、元数据头、检索扩展、delete_content；移除分类与块级工具 |
| 2026-08-19 | 新增 get_plugin_version 工具；initialize 的 serverInfo.version 与 package.json 同步 |
| 2026-08-19 | 快速写入：三层分类 resource、一次 create_doc、干净 Markdown 读回；list_* 改为 resources |
| 2026-08-19 | 检索改为 grep 模式：只返回去重文档与命中片段；修复 `read_note` 把标题 `#` 当成空标签 |
| 2026-08-18 | 记录/检索短链路落地：子文档分类写入、正文与标签检索、一次读取双链与附件 |
| 2026-08-18 | Cursor Streamable HTTP：补 GET /mcp SSE、initialized 返回 202；本地 HTTPS 内核不再因证书校验失败而无法握手 |
| 2026-08-18 | 集市已下载列表改为不透明 RGB `icon.png`（160×160），并补 `preview.png`；插件加载时刷新图标缓存 |
