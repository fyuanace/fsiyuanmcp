import { SiYuanClient } from "./client.js";
import {
  assertBlockId,
  cleanExportedMarkdown,
  clipText,
  isBlockId,
  markdownToPlainText,
  parseTagField,
  snippet
} from "./format.js";
import { countDocSize, parseNoteMeta, type NoteMeta } from "./meta.js";
import { buildTitleIndex, siyuanRefsToWiki } from "./wikilinks.js";
import {
  appendAssetLocalPathsFooter,
  appendAssetLocalPathsPlain,
  classifyAssetKind,
  normalizeAssetSrc,
  resolveDocAssets,
  type DocAsset
} from "./assets.js";

export type AssetAccess = DocAsset;

export type NoteRef = {
  id: string;
  docId?: string;
  notebookId?: string;
  hPath?: string;
  title?: string;
  snippet?: string;
};

export type ReadNoteResult = {
  id: string;
  docId: string;
  notebookId: string;
  path: string;
  hPath: string;
  title: string;
  markdown: string;
  text?: string;
  truncated: boolean;
  tags: string[];
  summary: string;
  updated: string;
  refs: string[];
  meta: NoteMeta;
  charCount: number;
  tooLarge: boolean;
  backlinks: NoteRef[];
  outgoingRefs: NoteRef[];
  assets: AssetAccess[];
};

type BlockInfo = {
  box?: string;
  path?: string;
  rootID?: string;
  rootTitle?: string;
};

type ExportMd = {
  hPath?: string;
  content?: string;
};

type SqlRefRow = {
  block_id?: string;
  def_block_id?: string;
  root_id?: string;
  def_block_root_id?: string;
  box?: string;
  path?: string;
  content?: string;
  markdown?: string;
  hpath?: string;
};

const ASSET_RE = /(!?)\[[^\]]*]\((assets\/[^)\s]+)\)/g;
const HTML_ASSET_RE = /(?:src|href)=["'](assets\/[^"']+)["']/gi;

function truncateMarkdown(markdown: string, maxChars: number): { text: string; truncated: boolean } {
  return clipText(markdown, maxChars);
}

function classifyAsset(src: string): "image" | "file" {
  return classifyAssetKind(src);
}

export function extractAssets(markdown: string): AssetAccess[] {
  const seen = new Set<string>();
  const assets: AssetAccess[] = [];
  const push = (srcRaw: string, kindHint?: "image" | "file") => {
    const src = normalizeAssetSrc(srcRaw);
    if (!src || seen.has(src)) {
      return;
    }
    seen.add(src);
    assets.push({
      kind: kindHint ?? classifyAsset(src),
      src
    });
  };

  for (const match of markdown.matchAll(ASSET_RE)) {
    push(match[2], match[1] === "!" ? "image" : classifyAsset(match[2]));
  }
  for (const match of markdown.matchAll(HTML_ASSET_RE)) {
    push(match[1]);
  }
  return assets;
}

async function sql<T>(client: Pick<SiYuanClient, "post">, stmt: string): Promise<T[]> {
  const rows = await client.post<T[]>("/api/query/sql", { stmt });
  return Array.isArray(rows) ? rows : [];
}

async function resolveTargetId(
  client: Pick<SiYuanClient, "post">,
  input: { id?: string; notebookId?: string; path?: string }
): Promise<string> {
  if (input.id) {
    return assertBlockId(input.id);
  }
  if (!input.notebookId || !input.path) {
    throw new Error("read_note requires id, or notebookId + path");
  }
  const path = input.path.trim();
  if (isBlockId(path.replace(/^\//, "").replace(/\.sy$/, ""))) {
    const ids = await client
      .post<string[]>("/api/filetree/getIDsByHPath", {
        notebook: input.notebookId,
        path
      })
      .catch(() => null);
    if (ids?.[0]) {
      return ids[0];
    }
  }
  const ids = await client.post<string[]>("/api/filetree/getIDsByHPath", {
    notebook: input.notebookId,
    path: path.startsWith("/") ? path : `/${path}`
  });
  if (!ids?.[0]) {
    throw new Error(`Document not found: ${input.notebookId} ${path}`);
  }
  return ids[0];
}

function toRef(row: SqlRefRow, idKey: "block_id" | "def_block_id", titleMap: Map<string, string>): NoteRef | null {
  const id = String(row[idKey] ?? "").trim();
  if (!id) {
    return null;
  }
  const docId = String(row.def_block_root_id || row.root_id || "");
  const hPath = String(row.hpath ?? row.path ?? "");
  return {
    id,
    docId,
    notebookId: String(row.box ?? ""),
    hPath,
    title: titleMap.get(docId) || titleMap.get(id) || hPath.split("/").filter(Boolean).at(-1) || "",
    snippet: snippet(String(row.content || row.markdown || ""), 160)
  };
}

export async function readNote(
  client: Pick<SiYuanClient, "post">,
  input: { id?: string; notebookId?: string; path?: string; maxChars?: number; format?: "markdown" | "text" }
): Promise<ReadNoteResult> {
  const id = await resolveTargetId(client, input);
  const maxChars = Math.min(Math.max(input.maxChars ?? 12000, 1000), 40000);

  let info: BlockInfo = {};
  try {
    info = await client.post<BlockInfo>("/api/block/getBlockInfo", { id });
  } catch {
    info = {};
  }
  const docId = info.rootID || id;
  const notebookId = String(info.box || input.notebookId || "");

  const exported = await client.post<ExportMd>("/api/export/exportMdContent", { id: docId });
  const title = String(info.rootTitle || (exported.hPath ?? "").split("/").filter(Boolean).at(-1) || "");
  const rawMarkdown = exported.content ?? "";
  let cleaned = cleanExportedMarkdown(rawMarkdown, title);

  const titleIndex =
    notebookId.length > 0 ? await buildTitleIndex(client, notebookId).catch(() => new Map<string, string>()) : new Map();
  const idToTitle = new Map<string, string>();
  for (const [docTitle, docIdValue] of titleIndex.entries()) {
    idToTitle.set(docIdValue, docTitle);
  }
  cleaned = siyuanRefsToWiki(cleaned, idToTitle);

  const parsedMeta = parseNoteMeta(cleaned);
  const size = countDocSize(cleaned);
  const clipped = truncateMarkdown(cleaned, maxChars);
  const bodyMarkdown = clipped.text;
  const bodyText = input.format === "text" ? markdownToPlainText(bodyMarkdown) : undefined;

  const tagRows = await sql<{ tag?: string; hpath?: string; box?: string; path?: string; content?: string; updated?: string }>(
    client,
    `SELECT tag, hpath, box, path, content, updated FROM blocks WHERE id='${docId}' LIMIT 1`
  );
  // Tags come from YAML frontmatter (or legacy meta block), not SiYuan document attributes.
  let tags = parsedMeta.meta.tags;
  if (tags.length === 0) {
    tags = parseTagField(tagRows[0]?.tag);
  }
  if (tags.length === 0) {
    tags = parseTagField(rawMarkdown);
  }

  const backlinkRows = await sql<SqlRefRow>(
    client,
    `SELECT r.block_id, r.root_id, r.box, r.path, r.content, r.markdown, b.hpath FROM refs r LEFT JOIN blocks b ON b.id = r.block_id WHERE r.def_block_id = '${id}' OR r.def_block_root_id = '${docId}' LIMIT 40`
  );
  const outgoingRows = await sql<SqlRefRow>(
    client,
    `SELECT r.def_block_id, r.def_block_root_id, r.box, r.path, r.content, r.markdown, b.hpath FROM refs r LEFT JOIN blocks b ON b.id = r.def_block_id WHERE r.root_id = '${docId}' LIMIT 40`
  );

  const imageAssets = await client
    .post<string[]>("/api/asset/getDocImageAssets", { id: docId })
    .catch(() => [] as string[]);
  let assets = extractAssets(bodyMarkdown);
  for (const src of imageAssets ?? []) {
    if (typeof src === "string" && src.startsWith("assets/")) {
      const extra = extractAssets(`![](${src})`);
      for (const item of extra) {
        if (!assets.some((asset) => asset.src === item.src)) {
          assets.push(item);
        }
      }
    }
  }
  assets = await resolveDocAssets(client, assets);

  const markdownWithAssets = appendAssetLocalPathsFooter(bodyMarkdown, assets);
  const textWithAssets =
    input.format === "text"
      ? appendAssetLocalPathsPlain(bodyText ?? markdownToPlainText(bodyMarkdown), assets)
      : undefined;

  const updatedRaw = String(tagRows[0]?.updated ?? "");
  const updated =
    parsedMeta.meta.updated ||
    (updatedRaw.length >= 8 ? `${updatedRaw.slice(0, 4)}-${updatedRaw.slice(4, 6)}-${updatedRaw.slice(6, 8)}` : "");

  const meta: NoteMeta = {
    summary: parsedMeta.meta.summary,
    updated,
    tags,
    refs: parsedMeta.meta.refs
  };

  return {
    id,
    docId,
    notebookId: String(info.box || tagRows[0]?.box || ""),
    path: String(info.path || tagRows[0]?.path || ""),
    hPath: String(exported.hPath || tagRows[0]?.hpath || ""),
    title,
    markdown: input.format === "text" ? textWithAssets ?? markdownWithAssets : markdownWithAssets,
    ...(textWithAssets !== undefined ? { text: textWithAssets } : {}),
    truncated: clipped.truncated,
    tags,
    summary: meta.summary,
    updated: meta.updated,
    refs: meta.refs,
    meta,
    charCount: size.charCount,
    tooLarge: size.tooLarge,
    backlinks: backlinkRows.map((row) => toRef(row, "block_id", idToTitle)).filter((item): item is NoteRef => Boolean(item)),
    outgoingRefs: outgoingRows
      .map((row) => toRef(row, "def_block_id", idToTitle))
      .filter((item): item is NoteRef => Boolean(item)),
    assets
  };
}
