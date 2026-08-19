import type { SiYuanClient } from "./client.js";
import type { StandardResult } from "./contracts.js";
import {
  ensureMarkdownTags,
  escapeSqlLiteral,
  isBlockId,
  stripLeadingTitleHeading
} from "./format.js";
import { countDocSize, injectNoteMeta, mergeRefsFromBody, type NoteMeta } from "./meta.js";
import {
  resolveTitleInNotebook,
  wikiLinksToSiyuan,
  type WikiLinkConvertResult
} from "./wikilinks.js";

export type SaveNoteInput = {
  notebookId: string;
  title: string;
  markdown?: string;
  summary?: string;
  tags?: string[];
  refs?: string[];
};

export type SaveNoteResult = {
  id: string;
  title: string;
  path: string;
  created: boolean;
  meta: NoteMeta;
  charCount: number;
  tooLarge: boolean;
  unresolvedRefs: string[];
  message: string;
};

function flatPath(title: string): string {
  const safe = title.trim().replaceAll("\\", "-").replaceAll("/", "-");
  if (!safe) {
    throw new Error("title is required");
  }
  return `/${safe}`;
}

async function listChildIds(client: Pick<SiYuanClient, "post">, parentId: string): Promise<string[]> {
  const children = await client
    .post<Array<{ id?: string }>>("/api/block/getChildBlocks", { id: parentId })
    .catch(() => [] as Array<{ id?: string }>);
  return (children ?? []).map((item) => String(item.id ?? "").trim()).filter((id) => isBlockId(id));
}

async function replaceDocMarkdown(
  client: Pick<SiYuanClient, "post">,
  docId: string,
  markdown: string
): Promise<void> {
  const childIds = await listChildIds(client, docId);
  for (const id of childIds) {
    await client.post("/api/block/deleteBlock", { id }).catch(() => undefined);
  }
  if (!markdown.trim()) {
    return;
  }
  await client.post<StandardResult>("/api/block/appendBlock", {
    parentID: docId,
    dataType: "markdown",
    data: markdown
  });
}

export async function saveNote(
  client: Pick<SiYuanClient, "post">,
  input: SaveNoteInput
): Promise<SaveNoteResult> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("save_note requires title");
  }
  const path = flatPath(title);
  const existingId = await resolveTitleInNotebook(client, input.notebookId, title);

  let body = stripLeadingTitleHeading(input.markdown ?? "", title);
  const refs = mergeRefsFromBody(input.refs ?? [], body);
  const injected = injectNoteMeta(body, {
    summary: input.summary,
    tags: input.tags,
    refs,
    updated: new Date().toISOString()
  });
  body = ensureMarkdownTags(injected.markdown, injected.meta.tags);

  const converted: WikiLinkConvertResult = await wikiLinksToSiyuan(body, (linkTitle) =>
    resolveTitleInNotebook(client, input.notebookId, linkTitle)
  );
  const size = countDocSize(converted.markdown);

  let id = existingId;
  let created = false;
  if (existingId) {
    await replaceDocMarkdown(client, existingId, converted.markdown);
  } else {
    const result = await client.post<string | StandardResult>("/api/filetree/createDocWithMd", {
      notebook: input.notebookId,
      path,
      markdown: converted.markdown
    });
    id = typeof result === "string" ? result : String(result.id ?? "");
    created = true;
  }
  if (!id || !isBlockId(id)) {
    throw new Error("save_note failed to obtain document id");
  }

  if (injected.meta.tags.length > 0) {
    await client
      .post("/api/attr/setBlockAttrs", {
        id,
        attrs: { tags: injected.meta.tags.map((tag) => tag.replaceAll("#", "")).join(",") }
      })
      .catch(() => undefined);
  }

  const tooLargeHint = size.tooLarge
    ? "文档已偏大，后续新内容建议另建文档并用 [[标题]] 互链。"
    : "";
  return {
    id,
    title,
    path,
    created,
    meta: injected.meta,
    charCount: size.charCount,
    tooLarge: size.tooLarge,
    unresolvedRefs: converted.unresolvedRefs,
    message: created
      ? `已新建文档${tooLargeHint ? `；${tooLargeHint}` : ""}`
      : `已更新同名文档并保留 id${tooLargeHint ? `；${tooLargeHint}` : ""}`
  };
}

export async function findDocByTitle(
  client: Pick<SiYuanClient, "post">,
  notebookId: string,
  title: string
): Promise<{ id: string; path: string } | null> {
  const id = await resolveTitleInNotebook(client, notebookId, title);
  if (!id) {
    return null;
  }
  return { id, path: flatPath(title) };
}

export async function listDocTitles(
  client: Pick<SiYuanClient, "post">,
  notebookId: string
): Promise<Map<string, string>> {
  const box = escapeSqlLiteral(notebookId);
  const rows = await client.post<Array<{ id?: string; content?: string; hpath?: string }>>("/api/query/sql", {
    stmt: `SELECT id, content, hpath FROM blocks WHERE box='${box}' AND type='d' LIMIT 8000`
  });
  const map = new Map<string, string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row.id ?? "").trim();
    if (!isBlockId(id)) {
      continue;
    }
    const title =
      String(row.content ?? "").trim() ||
      String(row.hpath ?? "")
        .split("/")
        .filter(Boolean)
        .at(-1) ||
      "";
    if (title) {
      map.set(id, title);
    }
  }
  return map;
}
