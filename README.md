# 思源 HTTP MCP 服务

扁平长标题笔记 + 标签/双链图谱。写操作限制在一个可写笔记本。

## 核心能力

- **写入** `save_note(title, markdown, summary?, tags?, refs?)`：同名更新保留 id；标准 Markdown；`[[标题]]` 自动转思源双链
- **检索** `search_notes`：命中 + 图谱邻居；少命中直接带全文，多命中只给元数据
- **读取** `read_note`：干净 Markdown（含元数据头与 `[[标题]]`）
- **删除** `delete_content`：默认删匹配段落；整篇需 `scope=document` + `confirm=true`
- **版本** `get_plugin_version`

## 推荐流程

1. `search_notes({ query })` → 若 `includeFullText` 则已有正文；否则按 summary/tags/refs 筛选
2. `read_note({ id })` 读 2～4 篇
3. `save_note({ title, markdown, summary, tags, refs })` 新建或更新
4. 相关删除：`delete_content({ query })`；整篇再加 `scope:"document", confirm:true`

## 文档约定

- 无分类文件夹；标题建议 15～40 字概括主题
- 顶部元数据：主要内容 / 更新日期 / 标签 / 引用文档
- 文档过大时结果带 `tooLarge`，新内容另建并用 `[[旧标题]]` 互链

## Resources

- `siyuan://tags`
- `siyuan://notebooks`

## 启动

```bash
npm install
npm run build
npm run dev
```

默认 MCP：`http://127.0.0.1:3900/mcp`。改工具后需重启服务并在 Cursor 重连。

思源插件设置页可用「读取后端版本」对照 `plugin.json` 与正在监听的进程；不一致时先点「保存并重启」。

## 测试

```bash
npm test
```
