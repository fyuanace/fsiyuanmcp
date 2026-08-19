import type { SiYuanClient } from "../siyuan/client.js";
import type { LsNotebooksData } from "../siyuan/contracts.js";
import { flattenTagTree } from "../siyuan/format.js";
import { getResourceDescriptors, type McpResourceDescriptor } from "./catalog.js";

export type McpResourceContents = {
  uri: string;
  mimeType: string;
  text: string;
};

export const MCP_INSTRUCTIONS = [
  "无分类：文档扁平保存在可写笔记本根下，用较长 title 概括主题。",
  "写入用 save_note(title, markdown, summary?, tags?, refs?)。同名更新并保留 id；正文用标准 Markdown。仅配置的可写笔记本允许 save/delete。",
  "引用文档写 [[文档标题]]，服务会转成思源双链；读回仍是 [[标题]]。",
  "文档顶部有元数据：主要内容、更新日期、标签、引用文档；用标签与双链形成图谱。",
  "浏览用 list_docs；检索用 search_notes（文档名→标题块，命中≤5 附全文）。",
  "read_note 正文末尾自动附附件本地路径；Agent 可直接 Read 这些路径读图片/文件。",
  "删除用 delete_content 或 delete_docs（confirm=true）；文档过大时 tooLarge=true 请另建互链。"
].join(" ");

export class McpResourcesService {
  public constructor(
    private readonly client: SiYuanClient,
    private readonly writableNotebookId: string
  ) {}

  public listResources(): McpResourceDescriptor[] {
    return getResourceDescriptors();
  }

  public async readResource(uri: string): Promise<McpResourceContents> {
    const normalized = uri.trim();
    if (normalized === "siyuan://tags") {
      return this.jsonResource(normalized, await this.loadTags());
    }
    if (normalized === "siyuan://notebooks") {
      return this.jsonResource(normalized, await this.loadNotebooks());
    }
    throw new Error(`Unknown resource: ${uri}`);
  }

  private jsonResource(uri: string, data: unknown): McpResourceContents {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2)
    };
  }

  private async loadNotebooks(): Promise<unknown> {
    const data = await this.client.post<LsNotebooksData>("/api/notebook/lsNotebooks", {});
    return {
      writableNotebookId: this.writableNotebookId,
      notebooks: (data.notebooks ?? []).map((notebook) => ({
        id: notebook.id,
        name: notebook.name,
        writable: notebook.id === this.writableNotebookId
      }))
    };
  }

  private async loadTags(): Promise<unknown> {
    const tree = await this.client.post<unknown>("/api/tag/getTag", { sort: 0 });
    return {
      tags: flattenTagTree(tree),
      message: "写入 save_note 时可复用这些标签名"
    };
  }
}
