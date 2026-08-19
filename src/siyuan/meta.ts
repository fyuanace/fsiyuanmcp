import { normalizeTag, normalizeTags, parseTagField } from "./format.js";

export const LARGE_DOC_CHARS = 12000;
export const LARGE_DOC_CJK_APPROX = 8000;

export type NoteMeta = {
  summary: string;
  updated: string;
  tags: string[];
  refs: string[];
};

const META_START = "<!-- fsiyuanmcp-meta -->";
const META_END = "<!-- /fsiyuanmcp-meta -->";

function formatDate(value?: string | Date): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

export function countDocSize(markdown: string): { charCount: number; tooLarge: boolean } {
  const charCount = markdown.replace(/\s+/g, "").length;
  const cjk = [...markdown].filter((ch) => /\p{Script=Han}/u.test(ch)).length;
  return {
    charCount,
    tooLarge: charCount >= LARGE_DOC_CHARS || cjk >= LARGE_DOC_CJK_APPROX
  };
}

export function parseNoteMeta(markdown: string): { meta: NoteMeta; body: string } {
  const empty: NoteMeta = { summary: "", updated: "", tags: [], refs: [] };
  const start = markdown.indexOf(META_START);
  const end = markdown.indexOf(META_END);
  if (start === -1 || end === -1 || end < start) {
    // Fallback: leading bullet meta without markers
    const lines = markdown.split(/\r?\n/);
    let i = 0;
    const meta: NoteMeta = { ...empty };
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i += 1;
        continue;
      }
      const summary = line.match(/^[-*]\s*主要内容[：:]\s*(.*)$/);
      const updated = line.match(/^[-*]\s*更新日期[：:]\s*(.*)$/);
      const tags = line.match(/^[-*]\s*标签[：:]\s*(.*)$/);
      const refs = line.match(/^[-*]\s*引用文档[：:]\s*(.*)$/);
      if (summary) {
        meta.summary = summary[1].trim();
        i += 1;
        continue;
      }
      if (updated) {
        meta.updated = updated[1].trim();
        i += 1;
        continue;
      }
      if (tags) {
        meta.tags = parseTagField(tags[1]);
        if (meta.tags.length === 0) {
          meta.tags = normalizeTags(tags[1].split(/[,，\s]+/).filter(Boolean));
        }
        i += 1;
        continue;
      }
      if (refs) {
        meta.refs = [...refs[1].matchAll(/\[\[([^[\]]+)]]/g)].map((m) => m[1].trim()).filter(Boolean);
        i += 1;
        continue;
      }
      break;
    }
    return { meta, body: lines.slice(i).join("\n").replace(/^\n+/, "") };
  }

  const block = markdown.slice(start + META_START.length, end);
  const meta: NoteMeta = { ...empty };
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    const summary = line.match(/^[-*]\s*主要内容[：:]\s*(.*)$/);
    const updated = line.match(/^[-*]\s*更新日期[：:]\s*(.*)$/);
    const tags = line.match(/^[-*]\s*标签[：:]\s*(.*)$/);
    const refs = line.match(/^[-*]\s*引用文档[：:]\s*(.*)$/);
    if (summary) {
      meta.summary = summary[1].trim();
    } else if (updated) {
      meta.updated = updated[1].trim();
    } else if (tags) {
      meta.tags = parseTagField(tags[1]);
      if (meta.tags.length === 0) {
        meta.tags = normalizeTags(tags[1].split(/[,，\s]+/).filter(Boolean));
      }
    } else if (refs) {
      meta.refs = [...refs[1].matchAll(/\[\[([^[\]]+)]]/g)].map((m) => m[1].trim()).filter(Boolean);
    }
  }
  const before = markdown.slice(0, start).trimEnd();
  const after = markdown.slice(end + META_END.length).replace(/^\n+/, "");
  const body = [before, after].filter(Boolean).join("\n\n");
  return { meta, body };
}

export function buildNoteMetaBlock(meta: Partial<NoteMeta> & { summary?: string }): string {
  const tags = normalizeTags(meta.tags);
  const refs = [...new Set((meta.refs ?? []).map((item) => item.trim()).filter(Boolean))];
  const lines = [
    META_START,
    `- 主要内容：${(meta.summary ?? "").trim()}`,
    `- 更新日期：${formatDate(meta.updated)}`,
    `- 标签：${tags.length ? tags.join(" ") : ""}`,
    `- 引用文档：${refs.map((title) => `[[${title}]]`).join(" ")}`,
    META_END
  ];
  return lines.join("\n");
}

export function injectNoteMeta(
  markdown: string,
  input: {
    summary?: string;
    updated?: string;
    tags?: string[];
    refs?: string[];
  }
): { markdown: string; meta: NoteMeta } {
  const parsed = parseNoteMeta(markdown);
  const tags = normalizeTags([...(parsed.meta.tags ?? []), ...(input.tags ?? [])]);
  const refs = [
    ...new Set([...(parsed.meta.refs ?? []), ...(input.refs ?? [])].map((item) => item.trim()).filter(Boolean))
  ];
  const summary = (input.summary ?? parsed.meta.summary).trim();
  const meta: NoteMeta = {
    summary,
    updated: formatDate(input.updated ?? parsed.meta.updated),
    tags,
    refs
  };
  const body = parsed.body.replace(/^\n+/, "").replace(/\n+$/, "");
  const block = buildNoteMetaBlock(meta);
  const markdownOut = body ? `${block}\n\n${body}\n` : `${block}\n`;
  return { markdown: markdownOut, meta };
}

export function mergeRefsFromBody(refs: string[], bodyMarkdown: string): string[] {
  const fromBody = [...bodyMarkdown.matchAll(/\[\[([^[\]]+)]]/g)].map((m) => m[1].trim()).filter(Boolean);
  return [...new Set([...refs, ...fromBody])];
}

export function ensureTagsNormalized(tags: string[]): string[] {
  return normalizeTags(tags.map((tag) => (tag.includes("#") ? tag : normalizeTag(tag))));
}
