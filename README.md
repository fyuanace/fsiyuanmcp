# 思源 HTTP MCP 服务

**仅桌面端**：支持 Windows / macOS / Linux 思源桌面客户端；**不支持**手机、平板等移动端（Android / iOS / Harmony）。MCP 需在本机拉起 Node 服务，供 Cursor 等客户端连接。

扁平长标题笔记 + 标签/双链图谱。写操作限制在一个可写笔记本。

## 核心能力

- **写入** `save_note(title, markdown, summary?, tags?, refs?)`：同名更新保留 id；标准 Markdown；`[[标题]]` 自动转思源双链（**仅可写笔记本**）
- **检索** `search_notes`：全库只读；两轮（文档名→标题块）；命中 ≤5 篇附全文；含图谱邻居
- **浏览** `list_docs`：列出笔记本顶层文档，或某文档的直接/递归子文档（任意笔记本只读）
- **读取** `read_note`：任意笔记本只读；正文末尾自动附附件本地路径（`assets[]` 同步列出）
- **删除** `delete_content` / `delete_docs`：按关键字或 id 批量删除（**仅可写笔记本**）
- **版本** `get_plugin_version`

## 推荐流程

1. `list_docs({ notebookId? })` 或 `list_docs({ parentId })` 浏览文档树
2. `search_notes({ query })` → 若 `includeFullText` 则已有正文；否则按 summary/tags/refs 筛选
3. `read_note({ id })` 读 2～4 篇
4. `save_note({ title, markdown, summary, tags, refs })` 新建或更新（仅可写笔记本）
5. 删除：`delete_docs({ ids, confirm:true })` 或 `delete_content({ query, scope:"document", confirm:true })`

## 文档约定

- 无分类文件夹；标题建议 15～40 字概括主题
- 顶部元数据：YAML frontmatter（主要内容 / 更新日期 / 标签 / 引用文档），不写思源文档属性
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
