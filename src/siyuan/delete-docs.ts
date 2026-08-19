import type { SiYuanClient } from "./client.js";
import type { StandardResult } from "./contracts.js";
import { assertBlockId, isBlockId } from "./format.js";

export type DeleteDocsInput = {
  ids: string[];
  confirm?: boolean;
  previewOnly?: boolean;
};

export type DeleteDocsTarget = {
  id: string;
  title: string;
  notebookId: string;
  hPath: string;
};

export type DeleteDocsSkipped = {
  id: string;
  reason: string;
};

export type DeleteDocsResult = {
  preview: boolean;
  deleted: boolean;
  targets: DeleteDocsTarget[];
  deletedIds: string[];
  skipped: DeleteDocsSkipped[];
  message: string;
};

type BlockInfo = {
  box?: string;
  path?: string;
  rootTitle?: string;
  content?: string;
  hpath?: string;
};

type SqlRow = {
  id?: string;
  content?: string;
  hpath?: string;
  box?: string;
  path?: string;
};

function pathDepth(path: string): number {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).length;
}

async function resolveDocTarget(
  client: Pick<SiYuanClient, "post">,
  id: string
): Promise<DeleteDocsTarget | null> {
  const info = await client.post<BlockInfo>("/api/block/getBlockInfo", { id }).catch(() => null);
  if (info?.box) {
    return {
      id,
      notebookId: String(info.box),
      title: String(info.rootTitle ?? info.content ?? id),
      hPath: String(info.hpath ?? info.path ?? "")
    };
  }

  const rows = await client.post<SqlRow[]>("/api/query/sql", {
    stmt: `SELECT id, content, hpath, box, path FROM blocks WHERE id='${id.replaceAll("'", "''")}' AND type='d' LIMIT 1`
  });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row?.box) {
    return null;
  }
  return {
    id,
    notebookId: String(row.box),
    title: String(row.content ?? row.hpath ?? id),
    hPath: String(row.hpath ?? row.path ?? "")
  };
}

export async function deleteDocs(
  client: Pick<SiYuanClient, "post">,
  input: DeleteDocsInput,
  writableNotebookId: string
): Promise<DeleteDocsResult> {
  const rawIds = [...new Set(input.ids.map((item) => item.trim()).filter(Boolean))];
  if (rawIds.length === 0) {
    throw new Error("delete_docs requires at least one document id");
  }

  const skipped: DeleteDocsSkipped[] = [];
  const targets: DeleteDocsTarget[] = [];

  for (const rawId of rawIds) {
    if (!isBlockId(rawId)) {
      skipped.push({ id: rawId, reason: "无效的文档 ID" });
      continue;
    }
    const id = assertBlockId(rawId);
    if (id === writableNotebookId) {
      skipped.push({ id, reason: "不能删除笔记本根文档" });
      continue;
    }

    const target = await resolveDocTarget(client, id);
    if (!target) {
      skipped.push({ id, reason: "文档不存在或无法解析" });
      continue;
    }
    if (target.notebookId !== writableNotebookId) {
      skipped.push({
        id,
        reason: `笔记本 ${target.notebookId} 为只读，仅可删除可写笔记本 ${writableNotebookId} 中的文档`
      });
      continue;
    }
    targets.push(target);
  }

  const uniqueTargets = [...new Map(targets.map((item) => [item.id, item])).values()].sort(
    (a, b) => pathDepth(b.hPath || b.id) - pathDepth(a.hPath || a.id)
  );

  if (uniqueTargets.length === 0) {
    return {
      preview: true,
      deleted: false,
      targets: [],
      deletedIds: [],
      skipped,
      message: skipped.length > 0 ? "没有可删除的文档" : "未提供有效文档 ID"
    };
  }

  const preview = input.previewOnly === true || input.confirm !== true;
  if (preview) {
    return {
      preview: true,
      deleted: false,
      targets: uniqueTargets,
      deletedIds: [],
      skipped,
      message: `预览：将删除 ${uniqueTargets.length} 篇文档。确认请传 confirm=true；仅预览请传 previewOnly=true`
    };
  }

  const deletedIds: string[] = [];
  for (const target of uniqueTargets) {
    await client.post<StandardResult>("/api/filetree/removeDocByID", { id: target.id }).catch(async () => {
      const info = await client
        .post<{ path?: string; box?: string }>("/api/block/getBlockInfo", { id: target.id })
        .catch(() => null);
      if (info?.path && info.box) {
        await client.post("/api/filetree/removeDoc", { notebook: info.box, path: info.path });
      } else {
        throw new Error(`Failed to delete document ${target.id}`);
      }
    });
    deletedIds.push(target.id);
  }

  return {
    preview: false,
    deleted: true,
    targets: uniqueTargets,
    deletedIds,
    skipped,
    message: `已删除 ${deletedIds.length} 篇文档${skipped.length > 0 ? `，跳过 ${skipped.length} 项` : ""}`
  };
}
