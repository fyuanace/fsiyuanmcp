import type { SiYuanClient } from "./client.js";
import { escapeSqlLiteral, isBlockId } from "./format.js";
import { docIdFromStoragePath } from "./search.js";

export type DocListItem = {
  id: string;
  title: string;
  hPath: string;
  path: string;
  notebookId: string;
  updated?: string;
};

export type ListDocsInput = {
  notebookId?: string;
  parentId?: string;
  recursive?: boolean;
  limit?: number;
};

export type ListDocsResult = {
  notebookId: string;
  parentId: string | null;
  recursive: boolean;
  writable: boolean;
  documents: DocListItem[];
  message: string;
};

type SqlRow = {
  id?: string;
  content?: string;
  hpath?: string;
  path?: string;
  updated?: string;
  box?: string;
};

type BlockInfo = {
  box?: string;
  path?: string;
  rootID?: string;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function formatUpdated(raw?: string): string | undefined {
  const value = String(raw ?? "").trim();
  if (value.length >= 8) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value || undefined;
}

function titleFromRow(row: SqlRow): string {
  return (
    String(row.content ?? "").trim() ||
    String(row.hpath ?? "")
      .split("/")
      .filter(Boolean)
      .at(-1) ||
    docIdFromStoragePath(String(row.path ?? "")) ||
    String(row.id ?? "")
  );
}

function docFolderPath(storagePath: string): string {
  const norm = storagePath.replaceAll("\\", "/");
  if (norm.endsWith(".sy")) {
    return `${norm.slice(0, -3)}/`;
  }
  return norm.endsWith("/") ? norm : `${norm}/`;
}

function directChildClause(parentPrefix: string): string {
  const escaped = escapeSqlLiteral(parentPrefix);
  return `path LIKE '${escaped}%.sy' AND path NOT LIKE '${escaped}%/%.sy'`;
}

async function queryDocs(client: Pick<SiYuanClient, "post">, stmt: string): Promise<SqlRow[]> {
  const rows = await client.post<SqlRow[]>("/api/query/sql", { stmt });
  return Array.isArray(rows) ? rows : [];
}

async function resolveParent(
  client: Pick<SiYuanClient, "post">,
  notebookId: string,
  parentId?: string
): Promise<{ notebookId: string; parentId: string | null; parentPrefix: string | null }> {
  if (!parentId?.trim()) {
    return { notebookId, parentId: null, parentPrefix: "/" };
  }

  const id = parentId.trim();
  if (!isBlockId(id)) {
    throw new Error("list_docs parentId must be a SiYuan block id");
  }

  const info = (await client.post<BlockInfo>("/api/block/getBlockInfo", { id }).catch(() => null)) ?? {};
  const box = String(info.box ?? notebookId).trim();
  if (!box) {
    throw new Error(`Cannot resolve notebook for parent document ${id}`);
  }

  const storagePath = String(info.path ?? "").trim();
  if (!storagePath) {
    throw new Error(`Cannot resolve storage path for parent document ${id}`);
  }

  return {
    notebookId: box,
    parentId: id,
    parentPrefix: docFolderPath(storagePath)
  };
}

export async function listDocs(
  client: Pick<SiYuanClient, "post">,
  input: ListDocsInput,
  writableNotebookId: string
): Promise<ListDocsResult> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const recursive = input.recursive === true;
  const notebookHint = input.notebookId?.trim() || writableNotebookId;

  const parent = await resolveParent(client, notebookHint, input.parentId);
  const box = escapeSqlLiteral(parent.notebookId);
  const excludeRoot = `id <> '${escapeSqlLiteral(parent.notebookId)}'`;

  let stmt: string;
  if (recursive) {
    if (parent.parentPrefix && parent.parentPrefix !== "/") {
      const prefix = escapeSqlLiteral(parent.parentPrefix);
      stmt = `SELECT id, content, hpath, path, updated, box FROM blocks WHERE box='${box}' AND type='d' AND ${excludeRoot} AND path LIKE '${prefix}%' ORDER BY updated DESC LIMIT ${limit}`;
    } else {
      stmt = `SELECT id, content, hpath, path, updated, box FROM blocks WHERE box='${box}' AND type='d' AND ${excludeRoot} ORDER BY updated DESC LIMIT ${limit}`;
    }
  } else {
    const parentPrefix = parent.parentPrefix ?? "/";
    stmt = `SELECT id, content, hpath, path, updated, box FROM blocks WHERE box='${box}' AND type='d' AND ${excludeRoot} AND ${directChildClause(parentPrefix)} ORDER BY updated DESC LIMIT ${limit}`;
  }

  const rows = await queryDocs(client, stmt);
  const documents: DocListItem[] = [];
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (!isBlockId(id)) {
      continue;
    }
    documents.push({
      id,
      title: titleFromRow(row),
      hPath: String(row.hpath ?? ""),
      path: String(row.path ?? ""),
      notebookId: String(row.box ?? parent.notebookId),
      updated: formatUpdated(row.updated)
    });
  }

  const scope =
    parent.parentId === null
      ? recursive
        ? "笔记本全部文档"
        : "笔记本顶层文档"
      : recursive
        ? "子文档（含嵌套）"
        : "直接子文档";

  return {
    notebookId: parent.notebookId,
    parentId: parent.parentId,
    recursive,
    writable: parent.notebookId === writableNotebookId,
    documents,
    message:
      documents.length > 0
        ? `列出 ${documents.length} 篇${scope}${parent.notebookId === writableNotebookId ? "" : "（只读笔记本）"}`
        : `未找到${scope}`
  };
}
