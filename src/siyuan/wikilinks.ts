import { BLOCK_ID_RE, escapeSqlLiteral, isBlockId } from "./format.js";
import type { SiYuanClient } from "./client.js";

export const WIKI_LINK_RE = /\[\[([^[\]]+)]]/g;
export const SIYUAN_REF_RE =
  /\(\(([0-9]{14}-[0-9a-z]+)(?:\s+['"]([^'"]*)['"])?\)\)/gi;

export type TitleResolver = (title: string) => Promise<string | null> | string | null;

export type WikiLinkConvertResult = {
  markdown: string;
  unresolvedRefs: string[];
  resolved: Array<{ title: string; id: string }>;
};

export function extractWikiTitles(markdown: string): string[] {
  const titles: string[] = [];
  for (const match of markdown.matchAll(WIKI_LINK_RE)) {
    const title = match[1]?.trim();
    if (title && !titles.includes(title)) {
      titles.push(title);
    }
  }
  return titles;
}

export function extractSiyuanRefIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(SIYUAN_REF_RE)) {
    const id = match[1]?.trim();
    if (id && isBlockId(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

export async function wikiLinksToSiyuan(
  markdown: string,
  resolveTitle: TitleResolver
): Promise<WikiLinkConvertResult> {
  const unresolvedRefs: string[] = [];
  const resolved: Array<{ title: string; id: string }> = [];
  const cache = new Map<string, string | null>();

  const resolve = async (title: string): Promise<string | null> => {
    if (cache.has(title)) {
      return cache.get(title) ?? null;
    }
    const id = await resolveTitle(title);
    cache.set(title, id);
    return id;
  };

  let result = "";
  let lastIndex = 0;
  const matches = [...markdown.matchAll(WIKI_LINK_RE)];
  for (const match of matches) {
    const index = match.index ?? 0;
    result += markdown.slice(lastIndex, index);
    const title = match[1].trim();
    const id = await resolve(title);
    if (id) {
      const escaped = title.replaceAll("'", "\\'");
      result += `((${id} '${escaped}'))`;
      if (!resolved.some((item) => item.id === id)) {
        resolved.push({ title, id });
      }
    } else {
      result += match[0];
      if (!unresolvedRefs.includes(title)) {
        unresolvedRefs.push(title);
      }
    }
    lastIndex = index + match[0].length;
  }
  result += markdown.slice(lastIndex);
  return { markdown: result, unresolvedRefs, resolved };
}

export function siyuanRefsToWiki(
  markdown: string,
  idToTitle: Map<string, string> | Record<string, string>
): string {
  const lookup = idToTitle instanceof Map ? idToTitle : new Map(Object.entries(idToTitle));
  return markdown.replace(SIYUAN_REF_RE, (full, id: string, anchor?: string) => {
    const title = lookup.get(id)?.trim() || anchor?.trim();
    if (title) {
      return `[[${title}]]`;
    }
    return full;
  });
}

export async function buildTitleIndex(
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
    if (!BLOCK_ID_RE.test(id)) {
      continue;
    }
    const title =
      String(row.content ?? "").trim() ||
      String(row.hpath ?? "")
        .split("/")
        .filter(Boolean)
        .at(-1) ||
      "";
    if (title && !map.has(title)) {
      map.set(title, id);
    }
  }
  return map;
}

export async function resolveTitleInNotebook(
  client: Pick<SiYuanClient, "post">,
  notebookId: string,
  title: string,
  cache?: Map<string, string>
): Promise<string | null> {
  const trimmed = title.trim();
  if (!trimmed) {
    return null;
  }
  if (cache?.has(trimmed)) {
    return cache.get(trimmed) ?? null;
  }
  const path = `/${trimmed.replaceAll("\\", "-").replaceAll("/", "-")}`;
  const ids = await client
    .post<string[]>("/api/filetree/getIDsByHPath", { notebook: notebookId, path })
    .catch(() => [] as string[]);
  if (ids?.[0] && isBlockId(ids[0])) {
    cache?.set(trimmed, ids[0]);
    return ids[0];
  }
  const like = escapeSqlLiteral(trimmed);
  const box = escapeSqlLiteral(notebookId);
  const rows = await client
    .post<Array<{ id?: string }>>("/api/query/sql", {
      stmt: `SELECT id FROM blocks WHERE box='${box}' AND type='d' AND content='${like}' LIMIT 1`
    })
    .catch(() => [] as Array<{ id?: string }>);
  const id = String(rows?.[0]?.id ?? "").trim();
  if (isBlockId(id)) {
    cache?.set(trimmed, id);
    return id;
  }
  return null;
}
