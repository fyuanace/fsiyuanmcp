import type { SiYuanClient } from "./client.js";
import type { StandardResult } from "./contracts.js";
import { escapeSqlLiteral, isBlockId, sanitizeLikeQuery, snippet } from "./format.js";
import { docIdFromStoragePath } from "./search.js";

export type DeleteScope = "blocks" | "document";

export type DeleteContentInput = {
  notebookId: string;
  query: string;
  scope?: DeleteScope;
  confirm?: boolean;
  previewOnly?: boolean;
  limit?: number;
};

export type DeleteMatch = {
  id: string;
  docId: string;
  title: string;
  type: string;
  snippet: string;
};

export type DeleteContentResult = {
  scope: DeleteScope;
  preview: boolean;
  deleted: boolean;
  matches: DeleteMatch[];
  deletedIds: string[];
  message: string;
};

type SqlRow = {
  id?: string;
  root_id?: string;
  box?: string;
  path?: string;
  hpath?: string;
  type?: string;
  content?: string;
  markdown?: string;
};

function titleFromHPath(hPath: string): string {
  return hPath.split("/").filter(Boolean).at(-1) || hPath;
}

async function findMatches(
  client: Pick<SiYuanClient, "post">,
  notebookId: string,
  query: string,
  limit: number
): Promise<DeleteMatch[]> {
  const like = `%${sanitizeLikeQuery(query)}%`;
  const box = escapeSqlLiteral(notebookId);
  const rows = await client.post<SqlRow[]>("/api/query/sql", {
    stmt: `SELECT id, root_id, box, path, hpath, type, content, markdown FROM blocks WHERE box='${box}' AND type IN ('p','h','l','i','c','t','b','s','m','d') AND (content LIKE '${like}' OR markdown LIKE '${like}' OR name LIKE '${like}') LIMIT ${limit}`
  });
  const matches: DeleteMatch[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row.id ?? "").trim();
    if (!isBlockId(id)) {
      continue;
    }
    const path = String(row.path ?? "");
    const docId = String(row.root_id ?? "") || docIdFromStoragePath(path) || id;
    matches.push({
      id,
      docId,
      title: titleFromHPath(String(row.hpath ?? "")),
      type: String(row.type ?? ""),
      snippet: snippet(String(row.content || row.markdown || ""), 180)
    });
  }
  return matches;
}

export async function deleteContent(
  client: Pick<SiYuanClient, "post">,
  input: DeleteContentInput
): Promise<DeleteContentResult> {
  const query = input.query.trim();
  if (!query) {
    throw new Error("delete_content requires query");
  }
  const scope: DeleteScope = input.scope === "document" ? "document" : "blocks";
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const matches = await findMatches(client, input.notebookId, query, limit);

  if (matches.length === 0) {
    return {
      scope,
      preview: true,
      deleted: false,
      matches: [],
      deletedIds: [],
      message: "没有找到匹配内容"
    };
  }

  if (scope === "document") {
    if (!input.confirm) {
      const docs = [...new Map(matches.map((item) => [item.docId, item])).values()];
      return {
        scope,
        preview: true,
        deleted: false,
        matches: docs,
        deletedIds: [],
        message: `将删除 ${docs.length} 篇整篇文档。确认请再次调用并传 confirm=true`
      };
    }
    const docIds = [...new Set(matches.map((item) => item.docId).filter((id) => isBlockId(id)))];
    const deletedIds: string[] = [];
    for (const id of docIds) {
      await client.post<StandardResult>("/api/filetree/removeDocByID", { id }).catch(async () => {
        // Fallback: resolve storage path then removeDoc
        const info = await client
          .post<{ path?: string; box?: string }>("/api/block/getBlockInfo", { id })
          .catch(() => null);
        if (info?.path && info.box) {
          await client.post("/api/filetree/removeDoc", { notebook: info.box, path: info.path });
        }
      });
      deletedIds.push(id);
    }
    return {
      scope,
      preview: false,
      deleted: true,
      matches,
      deletedIds,
      message: `已删除 ${deletedIds.length} 篇文档`
    };
  }

  // blocks scope: default delete matching non-document blocks; document-type hits skipped unless only docs
  const blockMatches = matches.filter((item) => item.type !== "d");
  const targets = blockMatches.length > 0 ? blockMatches : matches;
  if (input.previewOnly) {
    return {
      scope,
      preview: true,
      deleted: false,
      matches: targets,
      deletedIds: [],
      message: `预览：将删除 ${targets.length} 个匹配块（非整篇）。去掉 previewOnly 后执行删除`
    };
  }

  const deletedIds: string[] = [];
  for (const item of targets) {
    if (item.type === "d") {
      continue;
    }
    await client.post("/api/block/deleteBlock", { id: item.id }).catch(() => undefined);
    deletedIds.push(item.id);
  }
  return {
    scope,
    preview: false,
    deleted: deletedIds.length > 0,
    matches: targets,
    deletedIds,
    message:
      deletedIds.length > 0
        ? `已删除 ${deletedIds.length} 个匹配块`
        : "命中的是文档节点；请用 scope=document 并 confirm=true 删除整篇"
  };
}
