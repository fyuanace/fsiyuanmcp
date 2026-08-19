export const BLOCK_ID_RE = /^[0-9]{14}-[0-9a-z]+$/i;

export function isBlockId(value: string): boolean {
  return BLOCK_ID_RE.test(value.trim());
}

export function assertBlockId(value: string, label = "id"): string {
  const id = value.trim();
  if (!isBlockId(id)) {
    throw new Error(`Invalid ${label}: expected SiYuan block id`);
  }
  return id;
}

export function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

export function sanitizeLikeQuery(value: string): string {
  return escapeSqlLiteral(value.replace(/[%_\\]/g, " "));
}

export function normalizeHPath(path: string): string {
  const trimmed = path.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  const parts = trimmed
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replaceAll("/", "-"));
  return `/${parts.join("/")}`;
}

export function joinHPath(parentPath: string | undefined, title: string): string {
  const parent = normalizeHPath(parentPath || "/");
  const safeTitle = title.trim().replaceAll("\\", "-").replaceAll("/", "-");
  if (!safeTitle) {
    throw new Error("Document title is required when creating a child document");
  }
  if (parent === "/") {
    return `/${safeTitle}`;
  }
  return `${parent}/${safeTitle}`;
}

export const MAX_HPATH_DEPTH = 3;

export function hpathParts(path: string): string[] {
  return normalizeHPath(path).split("/").filter(Boolean);
}

export function assertHPathDepth(path: string): string {
  const normalized = normalizeHPath(path);
  const parts = hpathParts(normalized);
  if (parts.length === 0) {
    throw new Error("文档路径为空");
  }
  if (parts.length > MAX_HPATH_DEPTH) {
    throw new Error(`分类最多三层：大层级 / 小层级 / 文档标题，当前为 ${parts.length} 层（${normalized}）`);
  }
  return normalized;
}

export function resolveCreateDocPath(input: {
  path?: string;
  parentPath?: string;
  title?: string;
  major?: string;
  minor?: string;
}): string {
  if (input.major?.trim() && input.title?.trim()) {
    const parent = input.minor?.trim()
      ? joinHPath(`/${input.major.trim()}`, input.minor.trim())
      : normalizeHPath(`/${input.major.trim()}`);
    return assertHPathDepth(joinHPath(parent, input.title));
  }
  if (input.title) {
    return assertHPathDepth(joinHPath(input.parentPath || input.path || "/", input.title));
  }
  if (input.path) {
    return assertHPathDepth(input.path);
  }
  throw new Error("create_doc requires major+title, parentPath+title, or path");
}

export function stripLeadingTitleHeading(markdown: string, title: string): string {
  const trimmed = markdown.replace(/^\uFEFF/, "");
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  const match = firstLine.match(/^#\s+(.+?)\s*$/);
  if (match && match[1].trim() === title.trim()) {
    return trimmed.slice(firstLine.length).replace(/^\r?\n+/, "");
  }
  return markdown;
}

export function cleanExportedMarkdown(raw: string, title?: string): string {
  let text = raw.replace(/^\uFEFF/, "").replace(/\u200b/g, "");
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      text = text.slice(end + 4).replace(/^\s+/, "");
    }
  }
  text = text.replace(/^[ \t]*\{:[^}]*\}[ \t]*$/gm, "");
  text = text.replace(/[ \t]\{:[^}]*\}/g, "");
  text = text.replace(/ {2,}$/gm, "");
  if (title?.trim()) {
    const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^#\\s+${escaped}\\s*(?:\\n+)`), "");
  }
  return text.replace(/^\n+/, "").replace(/\n+$/, "\n");
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, "").replace(/```$/, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\(\([0-9]{14}-[0-9a-z]+\s+['"]([^'"]+)['"]\)\)/gi, "$1")
    .replace(/\(\([0-9]{14}-[0-9a-z]+\)\)/gi, "")
    .replace(/#[^#\s]+#/g, (tag) => tag.replaceAll("#", ""))
    .replace(/[*_`>~]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTag(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Tag must not be empty");
  }
  const withoutHash = trimmed.replace(/^#+/, "").replace(/#+$/, "");
  if (!withoutHash) {
    throw new Error("Tag must not be empty");
  }
  return `#${withoutHash}#`;
}

export function normalizeTags(raw: string[] | undefined): string[] {
  if (!raw?.length) {
    return [];
  }
  return [...new Set(raw.map(normalizeTag))];
}

export function clipText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, maxChars)}\n\n…(内容已截断)`, truncated: true };
}

function looksLikeMarkdown(raw: string): boolean {
  return raw.includes("\n") || /^#{1,6}\s/.test(raw.trim()) || raw.length > 200;
}

export function parseTagField(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const matches = raw.match(/#[^#\s]+#/g) ?? [];
  if (matches.length > 0) {
    return [...new Set(matches.map(normalizeTag))];
  }
  if (looksLikeMarkdown(raw)) {
    return [];
  }
  const tags: string[] = [];
  for (const item of raw.split(/[,，\s]+/)) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const withoutHash = trimmed.replace(/^#+/, "").replace(/#+$/, "");
    if (!withoutHash) {
      continue;
    }
    tags.push(`#${withoutHash}#`);
  }
  return [...new Set(tags)];
}

export function ensureMarkdownTags(markdown: string, tags: string[]): string {
  if (tags.length === 0) {
    return markdown;
  }
  const missing = tags.filter((tag) => !markdown.includes(tag));
  if (missing.length === 0) {
    return markdown;
  }
  const suffix = missing.join(" ");
  if (!markdown.trim()) {
    return suffix;
  }
  return `${markdown.replace(/\s+$/, "")}\n\n${suffix}`;
}

export function flattenTagTree(nodes: unknown, acc: Array<{ name: string; count?: number }> = []): Array<{
  name: string;
  count?: number;
}> {
  if (!Array.isArray(nodes)) {
    return acc;
  }
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const item = node as { name?: string; label?: string; count?: number; children?: unknown };
    const name = String(item.name || item.label || "").trim();
    if (name) {
      acc.push({ name: name.replace(/^#+/, "").replace(/#+$/, ""), count: item.count });
    }
    if (item.children) {
      flattenTagTree(item.children, acc);
    }
  }
  return acc;
}

export function snippet(text: string, max = 220): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max)}…`;
}
