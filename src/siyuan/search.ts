import type { FullTextSearchData, SearchDocsItem } from "./contracts.js";
import { SiYuanClient } from "./client.js";
import {
  escapeSqlLiteral,
  isBlockId,
  normalizeTag,
  sanitizeLikeQuery,
  snippet
} from "./format.js";
import { countDocSize, parseNoteMeta } from "./meta.js";
import { cleanExportedMarkdown } from "./format.js";
import { buildTitleIndex, siyuanRefsToWiki } from "./wikilinks.js";

export type SearchSource = "doc-name" | "heading" | "content" | "tag" | "graph";

export type SearchHit = {
  id: string;
  docId: string;
  notebookId: string;
  path: string;
  hPath: string;
  type: string;
  title: string;
  snippet: string;
  matches: string[];
  tags: string[];
  summary?: string;
  refs?: string[];
  updated?: string;
  charCount?: number;
  tooLarge?: boolean;
  markdown?: string;
  relation?: "hit" | "tag-neighbor" | "ref-neighbor" | "backlink-neighbor";
  source: SearchSource;
  sources: SearchSource[];
};

export type SearchNotesResult = {
  source: "mixed" | "none";
  data: SearchHit[];
  neighbors: SearchHit[];
  includeFullText: boolean;
  message: string;
};

export type SearchNotesInput = {
  query?: string;
  keyword?: string;
  tag?: string;
  limit?: number;
  notebookId?: string;
  expandGraph?: boolean;
};

const HEADING_TYPES = {
  heading: true
};

export const DEFAULT_SEARCH_LIMIT = 8;
export const MAX_SEARCH_LIMIT = 12;
const MATCH_CHARS = 360;
const MAX_MATCHES = 3;
/** 命中文档篇数 ≤ 此值时 search 直接附带全文（不含图谱邻居） */
export const FULLTEXT_HIT_THRESHOLD = 5;

type SqlBlockRow = {
  id?: string;
  root_id?: string;
  box?: string;
  path?: string;
  hpath?: string;
  type?: string;
  content?: string;
  markdown?: string;
  name?: string;
  tag?: string;
  updated?: string;
  length?: number;
};

function titleFromHPath(hPath: string): string {
  return hPath.split("/").filter(Boolean).at(-1) || hPath;
}

export function docIdFromStoragePath(path: string): string {
  const name = path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "";
  const id = name.replace(/\.sy$/i, "");
  return isBlockId(id) ? id : "";
}

function asHitsFromDocs(docs: SearchDocsItem[]): SearchHit[] {
  return docs.map((doc) => {
    const docId = docIdFromStoragePath(doc.path);
    return {
      id: docId,
      docId,
      notebookId: doc.box,
      path: doc.path,
      hPath: doc.hPath,
      type: "d",
      title: titleFromHPath(doc.hPath),
      snippet: doc.hPath,
      matches: [],
      tags: [],
      relation: "hit" as const,
      source: "doc-name" as const,
      sources: ["doc-name"]
    };
  });
}

function asHitFromSql(row: SqlBlockRow, source: SearchSource, relation: SearchHit["relation"] = "hit"): SearchHit | null {
  const blockId = String(row.id ?? "").trim();
  if (!blockId) {
    return null;
  }
  const path = String(row.path ?? "");
  const docId = String(row.root_id ?? "") || docIdFromStoragePath(path) || blockId;
  const hPath = String(row.hpath ?? "");
  return {
    id: docId,
    docId,
    notebookId: String(row.box ?? ""),
    path,
    hPath,
    type: "d",
    title: String(row.name || titleFromHPath(hPath) || ""),
    snippet: snippet(String(row.content || row.markdown || ""), MATCH_CHARS),
    matches: [],
    tags: (row.tag ?? "").match(/#[^#\s]+#/g) ?? [],
    relation,
    source,
    sources: [source]
  };
}

function asHitsFromHeadingBlocks(blocks: FullTextSearchData["blocks"]): SearchHit[] {
  return (blocks ?? []).map((block) => {
    const docId = docIdFromStoragePath(block.path);
    return {
      id: docId || block.id,
      docId: docId || block.id,
      notebookId: block.box,
      path: block.path,
      hPath: block.hPath,
      type: "d",
      title: titleFromHPath(block.hPath),
      snippet: snippet(block.content ?? "", MATCH_CHARS),
      matches: [],
      tags: [],
      relation: "hit" as const,
      source: "heading" as const,
      sources: ["heading"]
    };
  });
}

function uniqueKey(hit: SearchHit): string {
  const docId = hit.docId || docIdFromStoragePath(hit.path);
  if (docId) {
    return `id:${docId}`;
  }
  return `path:${hit.notebookId}:${hit.path || hit.hPath}`;
}

function pushMatch(doc: SearchHit, text: string): void {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact || doc.matches.includes(compact) || doc.matches.length >= MAX_MATCHES) {
    return;
  }
  doc.matches.push(compact);
  doc.snippet = doc.matches.join(" … ");
}

function mergeToDocs(groups: SearchHit[][], limit: number): SearchHit[] {
  const byKey = new Map<string, SearchHit>();
  const order: string[] = [];
  for (const group of groups) {
    for (const hit of group) {
      const key = uniqueKey(hit);
      const existing = byKey.get(key);
      if (!existing) {
        const doc: SearchHit = { ...hit, sources: [hit.source], matches: [] };
        if (hit.source !== "doc-name" && hit.source !== "graph") {
          pushMatch(doc, hit.snippet);
        }
        byKey.set(key, doc);
        order.push(key);
        continue;
      }
      if (!existing.sources.includes(hit.source)) {
        existing.sources.push(hit.source);
      }
      if (hit.source !== "doc-name" && hit.source !== "graph") {
        pushMatch(existing, hit.snippet);
      }
      if (!existing.id) {
        existing.id = hit.docId || docIdFromStoragePath(hit.path) || hit.id;
        existing.docId = existing.id;
      }
      if (!existing.path && hit.path) {
        existing.path = hit.path;
      }
    }
  }
  return order.slice(0, limit).map((key) => {
    const doc = byKey.get(key)!;
    doc.source = doc.sources[0] ?? doc.source;
    if (!doc.snippet) {
      doc.snippet = doc.hPath || doc.title;
    }
    return doc;
  });
}

async function querySql(client: Pick<SiYuanClient, "post">, stmt: string): Promise<SqlBlockRow[]> {
  const rows = await client.post<SqlBlockRow[]>("/api/query/sql", { stmt });
  return Array.isArray(rows) ? rows : [];
}

async function fillDocIds(docs: SearchHit[]): Promise<void> {
  for (const doc of docs) {
    if (doc.id) {
      continue;
    }
    const fromPath = docIdFromStoragePath(doc.path);
    if (fromPath) {
      doc.id = fromPath;
      doc.docId = fromPath;
    }
  }
}

async function enrichMeta(
  client: Pick<SiYuanClient, "post">,
  docs: SearchHit[],
  options: { includeMarkdown: boolean; notebookId?: string }
): Promise<void> {
  const titleIndex = options.notebookId
    ? await buildTitleIndex(client, options.notebookId).catch(() => new Map<string, string>())
    : new Map<string, string>();
  const idToTitle = new Map<string, string>();
  for (const [title, id] of titleIndex.entries()) {
    idToTitle.set(id, title);
  }

  for (const doc of docs) {
    if (!doc.docId || !isBlockId(doc.docId)) {
      continue;
    }
    const rows = await querySql(
      client,
      `SELECT id, tag, hpath, content, updated, length FROM blocks WHERE id='${escapeSqlLiteral(doc.docId)}' LIMIT 1`
    );
    const row = rows[0];
    if (row) {
      doc.tags = (row.tag ?? "").match(/#[^#\s]+#/g) ?? doc.tags;
      doc.updated = row.updated
        ? `${String(row.updated).slice(0, 4)}-${String(row.updated).slice(4, 6)}-${String(row.updated).slice(6, 8)}`
        : doc.updated;
      if (typeof row.length === "number") {
        doc.charCount = row.length;
        doc.tooLarge = row.length >= 12000;
      }
      if (!doc.title) {
        doc.title = String(row.content || titleFromHPath(String(row.hpath ?? "")) || doc.title);
      }
    }

    try {
      const exported = await client.post<{ content?: string; hPath?: string }>("/api/export/exportMdContent", {
        id: doc.docId
      });
      let markdown = cleanExportedMarkdown(exported.content ?? "", doc.title);
      markdown = siyuanRefsToWiki(markdown, idToTitle);
      const meta = parseNoteMeta(markdown);
      doc.summary = meta.meta.summary || doc.summary;
      doc.refs = meta.meta.refs;
      if (meta.meta.tags.length) {
        doc.tags = meta.meta.tags;
      }
      if (meta.meta.updated) {
        doc.updated = meta.meta.updated;
      }
      const size = countDocSize(markdown);
      doc.charCount = size.charCount;
      doc.tooLarge = size.tooLarge;
      if (options.includeMarkdown) {
        doc.markdown = markdown;
      } else if (!doc.snippet || doc.snippet === doc.hPath) {
        doc.snippet = snippet(meta.body || markdown, MATCH_CHARS);
      }
    } catch {
      // keep existing snippet
    }
  }
}

async function expandGraphNeighbors(
  client: Pick<SiYuanClient, "post">,
  hits: SearchHit[],
  notebookId?: string
): Promise<SearchHit[]> {
  const neighbors: SearchHit[] = [];
  const seen = new Set(hits.map((hit) => hit.docId).filter(Boolean));
  const boxClause = notebookId ? ` AND box='${escapeSqlLiteral(notebookId)}'` : "";

  for (const hit of hits) {
    if (!hit.docId || !isBlockId(hit.docId)) {
      continue;
    }
    for (const tag of hit.tags.slice(0, 3)) {
      const like = `%${sanitizeLikeQuery(tag)}%`;
      const rows = await querySql(
        client,
        `SELECT id, root_id, box, path, hpath, type, content, markdown, name, tag FROM blocks WHERE type='d' AND tag LIKE '${like}'${boxClause} LIMIT 8`
      );
      for (const row of rows) {
        const neighbor = asHitFromSql(row, "graph", "tag-neighbor");
        if (!neighbor || seen.has(neighbor.docId)) {
          continue;
        }
        seen.add(neighbor.docId);
        neighbors.push(neighbor);
      }
    }

    const outRows = await querySql(
      client,
      `SELECT r.def_block_root_id AS id, r.def_block_root_id AS root_id, b.box, b.path, b.hpath, b.type, b.content, b.markdown, b.name, b.tag FROM refs r LEFT JOIN blocks b ON b.id = r.def_block_root_id WHERE r.root_id='${escapeSqlLiteral(hit.docId)}' LIMIT 12`
    );
    for (const row of outRows) {
      const neighbor = asHitFromSql(row, "graph", "ref-neighbor");
      if (!neighbor?.docId || seen.has(neighbor.docId) || !isBlockId(neighbor.docId)) {
        continue;
      }
      seen.add(neighbor.docId);
      neighbors.push(neighbor);
    }

    const backRows = await querySql(
      client,
      `SELECT r.root_id AS id, r.root_id AS root_id, b.box, b.path, b.hpath, b.type, b.content, b.markdown, b.name, b.tag FROM refs r LEFT JOIN blocks b ON b.id = r.root_id WHERE r.def_block_root_id='${escapeSqlLiteral(hit.docId)}' LIMIT 12`
    );
    for (const row of backRows) {
      const neighbor = asHitFromSql(row, "graph", "backlink-neighbor");
      if (!neighbor?.docId || seen.has(neighbor.docId) || !isBlockId(neighbor.docId)) {
        continue;
      }
      seen.add(neighbor.docId);
      neighbors.push(neighbor);
    }
  }

  return neighbors.slice(0, 12);
}

export async function searchNotes(
  client: Pick<SiYuanClient, "post">,
  input: SearchNotesInput
): Promise<SearchNotesResult> {
  const keyword = (input.query ?? input.keyword)?.trim() ?? "";
  const tag = input.tag?.trim() ? normalizeTag(input.tag) : "";
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
  const expandGraph = input.expandGraph !== false;

  if (!keyword && !tag) {
    throw new Error("search_notes requires query, keyword or tag");
  }

  const docHits: SearchHit[] = [];
  const headingHits: SearchHit[] = [];
  const tagHits: SearchHit[] = [];

  if (keyword) {
    const docs = await client.post<SearchDocsItem[]>("/api/filetree/searchDocs", {
      k: keyword,
      flashcard: false
    });
    docHits.push(...asHitsFromDocs(docs ?? []));

    if (docHits.length === 0) {
      const blockResult = await client
        .post<FullTextSearchData>("/api/search/fullTextSearchBlock", {
          query: keyword,
          page: 1,
          pageSize: Math.max(limit * 4, 20),
          types: HEADING_TYPES,
          method: 0,
          orderBy: 0,
          groupBy: 0
        })
        .then((blockData) => ({ ok: true as const, blockData }))
        .catch(() => ({ ok: false as const }));

      if (blockResult.ok) {
        headingHits.push(...asHitsFromHeadingBlocks(blockResult.blockData.blocks ?? []));
      } else {
        const like = `%${sanitizeLikeQuery(keyword)}%`;
        const rows = await querySql(
          client,
          `SELECT id, root_id, box, path, hpath, type, content, markdown, name, tag FROM blocks WHERE type='h' AND (content LIKE '${like}' OR markdown LIKE '${like}' OR name LIKE '${like}') LIMIT ${limit * 4}`
        );
        for (const row of rows) {
          const hit = asHitFromSql(row, "heading");
          if (hit) {
            headingHits.push(hit);
          }
        }
      }
    }
  }

  if (tag) {
    const like = `%${sanitizeLikeQuery(tag)}%`;
    const keywordClause = keyword
      ? ` AND (content LIKE '%${sanitizeLikeQuery(keyword)}%' OR markdown LIKE '%${sanitizeLikeQuery(keyword)}%' OR name LIKE '%${sanitizeLikeQuery(keyword)}%' OR hpath LIKE '%${sanitizeLikeQuery(keyword)}%')`
      : "";
    const rows = await querySql(
      client,
      `SELECT id, root_id, box, path, hpath, type, content, markdown, name, tag FROM blocks WHERE (tag LIKE '${like}' OR markdown LIKE '${like}' OR content LIKE '${like}')${keywordClause} LIMIT ${limit * 4}`
    );
    for (const row of rows) {
      const hit = asHitFromSql(row, "tag");
      if (hit) {
        tagHits.push(hit);
      }
    }
  }

  const data = mergeToDocs(tag ? [tagHits, docHits, headingHits] : [docHits, headingHits], limit);
  if (data.length === 0) {
    return { source: "none", data: [], neighbors: [], includeFullText: false, message: "没有搜到" };
  }

  await fillDocIds(data);
  await enrichMeta(client, data, { includeMarkdown: false, notebookId: input.notebookId });

  let neighbors: SearchHit[] = [];
  if (expandGraph) {
    neighbors = await expandGraphNeighbors(client, data, input.notebookId);
    if (neighbors.length > 0) {
      await enrichMeta(client, neighbors, { includeMarkdown: false, notebookId: input.notebookId });
    }
  }

  const includeFullText = data.length <= FULLTEXT_HIT_THRESHOLD;
  if (includeFullText) {
    await enrichMeta(client, data, { includeMarkdown: true, notebookId: input.notebookId });
  }

  const parts = [
    docHits.length ? `文档名 ${docHits.length}` : "",
    headingHits.length ? `标题 ${headingHits.length}` : "",
    tagHits.length ? `标签 ${tagHits.length}` : "",
    neighbors.length ? `图谱邻居 ${neighbors.length}` : ""
  ].filter(Boolean);

  const searchRound =
    keyword && docHits.length > 0 ? "文档名" : keyword && headingHits.length > 0 ? "标题块" : keyword ? "无命中" : "";

  return {
    source: "mixed",
    data,
    neighbors,
    includeFullText,
    message: includeFullText
      ? `命中 ${data.length} 篇（${searchRound || "标签"}），已直接附带全文 Markdown。`
      : `命中 ${data.length} 篇 + 邻居 ${neighbors.length} 篇（${parts.join(" / ")}）。请根据 summary/tags/refs 二次筛选后，用 read_note 读取 2～4 篇。`
  };
}

/** @deprecated use searchNotes */
export async function searchLimited(
  client: Pick<SiYuanClient, "post">,
  keyword: string
): Promise<SearchNotesResult> {
  return searchNotes(client, { keyword });
}
