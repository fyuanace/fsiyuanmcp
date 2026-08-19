import { z } from "zod";
import { ensureWritableNotebook } from "../siyuan/guards.js";
import { searchNotes } from "../siyuan/search.js";
import { readNote } from "../siyuan/notes.js";
import { saveNote } from "../siyuan/save.js";
import { deleteContent } from "../siyuan/delete.js";
import type { LsNotebooksData } from "../siyuan/contracts.js";
import { SiYuanClient } from "../siyuan/client.js";
import { getToolDescriptors, getToolGroups } from "./catalog.js";
import { getPluginVersionInfo } from "../version.js";

export type ToolGroup = {
  group: string;
  tools: string[];
};

export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  group: string;
};

export type McpToolsOptions = {
  writableNotebookId: string;
  mcpBaseUrl: string;
  siyuanBaseUrl: string;
};

const saveNoteSchema = z.object({
  notebookId: z.string().optional(),
  title: z.string().min(1),
  markdown: z.string().default(""),
  summary: z.string().optional(),
  tags: z.array(z.string()).default([]),
  refs: z.array(z.string()).default([])
});

const searchNotesSchema = z
  .object({
    query: z.string().optional(),
    keyword: z.string().optional(),
    tag: z.string().optional(),
    limit: z.number().int().positive().optional(),
    expandGraph: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.query?.trim() && !value.keyword?.trim() && !value.tag?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "search_notes requires query, keyword or tag"
      });
    }
  });

const readNoteSchema = z
  .object({
    id: z.string().optional(),
    notebookId: z.string().optional(),
    path: z.string().optional(),
    maxChars: z.number().int().positive().optional(),
    format: z.enum(["markdown", "text"]).optional()
  })
  .superRefine((value, ctx) => {
    if (!value.id?.trim() && !value.path?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "read_note requires id, or path"
      });
    }
  });

const deleteContentSchema = z.object({
  notebookId: z.string().optional(),
  query: z.string().min(1),
  scope: z.enum(["blocks", "document"]).optional(),
  confirm: z.boolean().optional(),
  previewOnly: z.boolean().optional(),
  limit: z.number().int().positive().optional()
});

export class McpToolsService {
  private readonly client: SiYuanClient;
  private readonly writableNotebookId: string;
  private readonly mcpBaseUrl: string;
  private readonly siyuanBaseUrl: string;

  public constructor(client: SiYuanClient, options: string | McpToolsOptions) {
    this.client = client;
    if (typeof options === "string") {
      this.writableNotebookId = options;
      this.mcpBaseUrl = "";
      this.siyuanBaseUrl = client.baseUrl;
      return;
    }
    this.writableNotebookId = options.writableNotebookId;
    this.mcpBaseUrl = options.mcpBaseUrl;
    this.siyuanBaseUrl = options.siyuanBaseUrl || client.baseUrl;
  }

  public listGroups(): ToolGroup[] {
    return getToolGroups();
  }

  public listTools(): McpToolDescriptor[] {
    return getToolDescriptors();
  }

  public async validateWritableNotebookExists(): Promise<void> {
    const data = await this.client.post<LsNotebooksData>("/api/notebook/lsNotebooks", {});
    const exists = data.notebooks.some((item) => item.id === this.writableNotebookId);
    if (!exists) {
      throw new Error(`Writable notebook id not found: ${this.writableNotebookId}`);
    }
  }

  public async callTool(name: string, args: unknown): Promise<unknown> {
    if (name === "get_plugin_version") {
      const info = getPluginVersionInfo();
      return {
        success: true,
        data: info,
        message: `fsiyuanmcp ${info.version}`
      };
    }
    if (name === "search_notes" || name === "search_limited") {
      const input = searchNotesSchema.parse(args);
      const result = await searchNotes(this.client, {
        ...input,
        notebookId: this.writableNotebookId
      });
      return {
        success: true,
        source: result.source,
        data: result.data,
        neighbors: result.neighbors,
        includeFullText: result.includeFullText,
        message: result.message
      };
    }
    if (name === "read_note") {
      const input = readNoteSchema.parse(args);
      const result = await readNote(
        this.client,
        {
          ...input,
          notebookId: this.resolveNotebookId(input.notebookId)
        },
        {
          mcpBaseUrl: this.mcpBaseUrl,
          siyuanBaseUrl: this.siyuanBaseUrl
        }
      );
      return {
        success: true,
        data: result,
        message: input.format === "text" ? "已返回纯文本正文" : "已返回干净 Markdown（含元数据与 [[标题]]）"
      };
    }

    const notebookId = this.resolveNotebookId(
      typeof args === "object" && args && "notebookId" in args
        ? String((args as { notebookId?: string }).notebookId ?? "")
        : ""
    );
    this.assertWriteAllowed(notebookId);

    if (name === "save_note" || name === "create_doc") {
      const input = saveNoteSchema.parse(
        name === "create_doc" && typeof args === "object" && args
          ? {
              ...(args as object),
              title:
                (args as { title?: string }).title ||
                (args as { path?: string }).path?.split("/").filter(Boolean).at(-1)
            }
          : args
      );
      const result = await saveNote(this.client, {
        notebookId,
        title: input.title,
        markdown: input.markdown,
        summary: input.summary,
        tags: input.tags,
        refs: input.refs
      });
      return {
        success: true,
        data: result,
        message: result.message
      };
    }

    if (name === "delete_content" || name === "remove_doc") {
      if (name === "remove_doc") {
        const legacy = z
          .object({
            notebookId: z.string().optional(),
            path: z.string().min(1),
            confirm: z.boolean().optional()
          })
          .parse(args);
        const title = legacy.path.split("/").filter(Boolean).at(-1) ?? legacy.path;
        const result = await deleteContent(this.client, {
          notebookId,
          query: title,
          scope: "document",
          confirm: legacy.confirm === true
        });
        return { success: true, data: result, message: result.message };
      }
      const input = deleteContentSchema.parse(args);
      const result = await deleteContent(this.client, {
        notebookId,
        query: input.query,
        scope: input.scope,
        confirm: input.confirm,
        previewOnly: input.previewOnly,
        limit: input.limit
      });
      return { success: true, data: result, message: result.message };
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  private resolveNotebookId(raw?: string): string {
    return raw?.trim() || this.writableNotebookId;
  }

  private assertWriteAllowed(notebookId: string): void {
    const decision = ensureWritableNotebook(this.writableNotebookId, notebookId);
    if (!decision.allowed) {
      throw new Error(decision.reason ?? "Write not allowed");
    }
  }
}
