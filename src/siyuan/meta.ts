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

const EMPTY_META: NoteMeta = { summary: "", updated: "", tags: [], refs: [] };

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

function yamlScalar(value: string): string {
  const text = value ?? "";
  if (text === "") {
    return '""';
  }
  if (/[:#{}[\],&*!|>'"%@`\n\r]/.test(text) || text.trim() !== text || /^-/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function unquoteYamlScalar(raw: string): string {
  const text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    try {
      return JSON.parse(text.startsWith("'") ? `"${text.slice(1, -1).replaceAll('"', '\\"')}"` : text);
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}

function tagDisplayName(tag: string): string {
  return tag.replace(/^#+/, "").replace(/#+$/, "").trim();
}

function parseYamlListValue(raw: string): string[] {
  const text = raw.trim();
  if (!text || text === "[]") {
    return [];
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((item) => unquoteYamlScalar(item))
      .map((item) => item.replace(/^\[\[/, "").replace(/]]$/, "").trim())
      .filter(Boolean);
  }
  return [unquoteYamlScalar(text)].filter(Boolean);
}

function parseYamlFrontmatterBlock(block: string): NoteMeta {
  const meta: NoteMeta = { ...EMPTY_META };
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i += 1;
      continue;
    }

    const keyMatch = trimmed.match(
      /^(主要内容|summary|更新日期|updated|标签|tags|引用文档|refs)\s*:\s*(.*)$/i
    );
    if (!keyMatch) {
      i += 1;
      continue;
    }

    const key = keyMatch[1].toLowerCase();
    const rest = keyMatch[2] ?? "";
    const listKeys = new Set(["标签", "tags", "引用文档", "refs"]);
    const isListKey = listKeys.has(keyMatch[1]) || listKeys.has(key);

    if (isListKey && !rest.trim()) {
      const items: string[] = [];
      i += 1;
      while (i < lines.length) {
        const itemLine = lines[i];
        const itemMatch = itemLine.match(/^\s*-\s+(.*)$/);
        if (!itemMatch) {
          break;
        }
        items.push(unquoteYamlScalar(itemMatch[1]).replace(/^\[\[/, "").replace(/]]$/, "").trim());
        i += 1;
      }
      if (key === "标签" || key === "tags") {
        meta.tags = normalizeTags(items.filter(Boolean));
      } else {
        meta.refs = [...new Set(items.filter(Boolean))];
      }
      continue;
    }

    if (key === "主要内容" || key === "summary") {
      meta.summary = unquoteYamlScalar(rest);
    } else if (key === "更新日期" || key === "updated") {
      meta.updated = unquoteYamlScalar(rest);
    } else if (key === "标签" || key === "tags") {
      const fromField = parseTagField(unquoteYamlScalar(rest));
      meta.tags =
        fromField.length > 0 ? fromField : normalizeTags(parseYamlListValue(rest).map(tagDisplayName));
    } else if (key === "引用文档" || key === "refs") {
      const quoted = unquoteYamlScalar(rest);
      const wiki = [...quoted.matchAll(/\[\[([^[\]]+)]]/g)].map((m) => m[1].trim()).filter(Boolean);
      meta.refs = wiki.length > 0 ? wiki : parseYamlListValue(rest);
    }
    i += 1;
  }
  return meta;
}

export function isOurMetaFrontmatter(block: string): boolean {
  return /(^|\n)\s*(主要内容|summary)\s*:/i.test(block) ||
    (/(^|\n)\s*(更新日期|updated)\s*:/i.test(block) && /(^|\n)\s*(标签|tags)\s*:/i.test(block)) ||
    /(^|\n)\s*(引用文档|refs)\s*:/i.test(block);
}

export function isSiYuanAttrFrontmatter(block: string): boolean {
  if (isOurMetaFrontmatter(block)) {
    return false;
  }
  return /(^|\n)\s*title\s*:/i.test(block);
}

export function splitYamlFrontmatter(markdown: string): {
  frontmatter: string | null;
  body: string;
  hasFence: boolean;
} {
  const text = markdown.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { frontmatter: null, body: text, hasFence: false };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: null, body: text, hasFence: false };
  }
  const afterClose = text.slice(end + 4);
  if (afterClose.length > 0 && !/^\r?\n|^$/.test(afterClose)) {
    // `---` must be on its own line
    return { frontmatter: null, body: text, hasFence: false };
  }
  const frontmatter = text.slice(3, end).replace(/^\r?\n/, "");
  const body = afterClose.replace(/^\r?\n/, "");
  return { frontmatter, body, hasFence: true };
}

function parseHtmlCommentMeta(markdown: string): { meta: NoteMeta; body: string } | null {
  const start = markdown.indexOf(META_START);
  const end = markdown.indexOf(META_END);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  const block = markdown.slice(start + META_START.length, end);
  const meta: NoteMeta = { ...EMPTY_META };
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

function parseBulletMetaFallback(markdown: string): { meta: NoteMeta; body: string } {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  const meta: NoteMeta = { ...EMPTY_META };
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

export function parseNoteMeta(markdown: string): { meta: NoteMeta; body: string } {
  const yaml = splitYamlFrontmatter(markdown);
  if (yaml.hasFence && yaml.frontmatter !== null && isOurMetaFrontmatter(yaml.frontmatter)) {
    return {
      meta: parseYamlFrontmatterBlock(yaml.frontmatter),
      body: yaml.body.replace(/^\n+/, "")
    };
  }

  const html = parseHtmlCommentMeta(markdown);
  if (html) {
    return html;
  }

  return parseBulletMetaFallback(markdown);
}

export function buildNoteMetaBlock(meta: Partial<NoteMeta> & { summary?: string }): string {
  const tags = normalizeTags(meta.tags).map(tagDisplayName);
  const refs = [...new Set((meta.refs ?? []).map((item) => item.trim()).filter(Boolean))];
  const lines = [
    "---",
    `主要内容: ${yamlScalar((meta.summary ?? "").trim())}`,
    `更新日期: ${formatDate(meta.updated)}`
  ];
  if (tags.length === 0) {
    lines.push("标签: []");
  } else {
    lines.push("标签:");
    for (const tag of tags) {
      lines.push(`  - ${yamlScalar(tag)}`);
    }
  }
  if (refs.length === 0) {
    lines.push("引用文档: []");
  } else {
    lines.push("引用文档:");
    for (const title of refs) {
      lines.push(`  - ${yamlScalar(title)}`);
    }
  }
  lines.push("---");
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
