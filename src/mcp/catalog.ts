import catalog from "../../tool-catalog.json" with { type: "json" };
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from "../siyuan/search.js";
import type { McpToolDescriptor, ToolGroup } from "./tools.js";

export type McpResourceDescriptor = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

const searchLimitProperty = {
  type: "integer",
  minimum: 1,
  maximum: MAX_SEARCH_LIMIT,
  default: DEFAULT_SEARCH_LIMIT,
  description: `返回去重后的文档篇数，默认 ${DEFAULT_SEARCH_LIMIT}，最大 ${MAX_SEARCH_LIMIT}；超出按最大值截断`
};

const inputSchemas: Record<string, Record<string, unknown>> = {
  get_plugin_version: { type: "object", properties: {} },
  search_notes: {
    type: "object",
    properties: {
      query: { type: "string", description: "关键字。返回命中与图谱邻居；少命中时带全文" },
      keyword: { type: "string", description: "同 query，兼容旧参数" },
      tag: { type: "string", description: "按标签检索，如 work 或 #work#" },
      limit: searchLimitProperty,
      expandGraph: {
        type: "boolean",
        description: "是否扩展同标签/双链邻居，默认 true"
      }
    }
  },
  search_limited: {
    type: "object",
    properties: {
      query: { type: "string" },
      keyword: { type: "string" },
      tag: { type: "string" },
      limit: searchLimitProperty
    }
  },
  read_note: {
    type: "object",
    properties: {
      id: { type: "string", description: "文档或块 ID（任意笔记本）" },
      notebookId: { type: "string", description: "按 path 读取时指定笔记本；省略则默认可写笔记本" },
      path: { type: "string", description: "人类可读路径，如 /文档标题" },
      maxChars: { type: "number", description: "正文最大字符数，默认 12000" },
      format: {
        type: "string",
        enum: ["markdown", "text"],
        description: "markdown=干净 Markdown（默认）；text=纯文本"
      }
    }
  },
  list_docs: {
    type: "object",
    properties: {
      notebookId: {
        type: "string",
        description: "笔记本 ID；省略 parentId 时默认插件配置的可写笔记本，也可指定其他笔记本（只读列出）"
      },
      parentId: {
        type: "string",
        description: "父文档 ID；传入时列出该文档的子文档（notebookId 可省略，将从父文档解析）"
      },
      recursive: {
        type: "boolean",
        description: "是否递归包含嵌套子文档，默认 false（仅直接子文档）"
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 500,
        default: 100,
        description: "最多返回篇数，默认 100，最大 500"
      }
    }
  },
  save_note: {
    type: "object",
    properties: {
      notebookId: { type: "string", description: "可省略，默认可写笔记本" },
      title: { type: "string", description: "文档标题，建议较长并概括主题；落在笔记本根下" },
      markdown: { type: "string", description: "标准 Markdown。引用用 [[文档标题]]" },
      summary: { type: "string", description: "主要内容一句话，写入元数据头" },
      tags: { type: "array", items: { type: "string" }, description: "标签，如 [\"qt\",\"1px\"]" },
      refs: {
        type: "array",
        items: { type: "string" },
        description: "引用文档标题列表，写入元数据并参与图谱"
      }
    },
    required: ["title"]
  },
  delete_content: {
    type: "object",
    properties: {
      notebookId: { type: "string", description: "可省略，默认可写笔记本（仅可写笔记本允许删除）" },
      query: { type: "string", description: "要删除的相关内容关键字" },
      scope: {
        type: "string",
        enum: ["blocks", "document"],
        description: "blocks=只删匹配块（默认）；document=删整篇"
      },
      confirm: {
        type: "boolean",
        description: "删整篇时必须为 true"
      },
      previewOnly: {
        type: "boolean",
        description: "为 true 时只预览将删内容，不执行"
      },
      limit: { type: "number", description: "最多匹配条数，默认 20" }
    },
    required: ["query"]
  },
  delete_docs: {
    type: "object",
    properties: {
      ids: {
        type: "array",
        items: { type: "string" },
        description: "要删除的文档 id 列表（仅可写笔记本中的文档会执行）"
      },
      confirm: {
        type: "boolean",
        description: "为 true 时执行批量删除"
      },
      previewOnly: {
        type: "boolean",
        description: "为 true 时只预览将删文档，不执行"
      }
    },
    required: ["ids"]
  }
};

export function getToolGroups(): ToolGroup[] {
  return catalog.groups;
}

export function getToolDescriptors(): McpToolDescriptor[] {
  return catalog.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    group: tool.group,
    inputSchema: inputSchemas[tool.name] ?? { type: "object", properties: {} }
  }));
}

export function getResourceDescriptors(): McpResourceDescriptor[] {
  return catalog.resources.map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    mimeType: resource.mimeType
  }));
}

export function getResourceTemplates(): Array<{
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}> {
  type ResourceTemplate = {
    uriTemplate: string;
    name: string;
    description: string;
    mimeType: string;
  };
  const templates = (catalog as { resourceTemplates?: ResourceTemplate[] }).resourceTemplates ?? [];
  return templates.map((resource) => ({
    uriTemplate: resource.uriTemplate,
    name: resource.name,
    description: resource.description,
    mimeType: resource.mimeType
  }));
}
