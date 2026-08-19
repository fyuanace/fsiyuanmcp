import type { SiYuanClient } from "./client.js";

export type DocAsset = {
  src: string;
  kind: "image" | "file";
  localPath?: string;
};

export function normalizeAssetSrc(raw: string): string | null {
  const src = raw.replace(/^\.\//, "").split("?")[0].replaceAll("\\", "/").trim();
  if (!src.startsWith("assets/") || src.includes("..") || src.includes("\0")) {
    return null;
  }
  return src;
}

export function classifyAssetKind(src: string): "image" | "file" {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(src) ? "image" : "file";
}

export async function resolveAssetLocalPath(
  client: Pick<SiYuanClient, "post">,
  src: string
): Promise<string | null> {
  const normalized = normalizeAssetSrc(src);
  if (!normalized) {
    return null;
  }
  try {
    const resolved = await client.post<string>("/api/asset/resolveAssetPath", { path: normalized });
    return typeof resolved === "string" && resolved.trim() ? resolved.trim() : null;
  } catch {
    return null;
  }
}

export async function resolveDocAssets(
  client: Pick<SiYuanClient, "post">,
  assets: DocAsset[]
): Promise<DocAsset[]> {
  const resolved: DocAsset[] = [];
  for (const asset of assets) {
    const localPath = await resolveAssetLocalPath(client, asset.src);
    resolved.push({
      ...asset,
      localPath: localPath ?? undefined
    });
  }
  return resolved;
}

export function appendAssetLocalPathsFooter(markdown: string, assets: DocAsset[]): string {
  const rows = assets.filter((asset) => asset.localPath);
  if (rows.length === 0) {
    return markdown;
  }
  const lines = [
    "",
    "---",
    "",
    "## 附件本地路径",
    "",
    ...rows.map((asset) => `- ${asset.kind}: \`${asset.src}\` → \`${asset.localPath}\``),
    ""
  ];
  return `${markdown.replace(/\n+$/, "")}\n${lines.join("\n")}`;
}

export function appendAssetLocalPathsPlain(text: string, assets: DocAsset[]): string {
  const rows = assets.filter((asset) => asset.localPath);
  if (rows.length === 0) {
    return text;
  }
  const lines = [
    "",
    "附件本地路径:",
    ...rows.map((asset) => `- ${asset.src} -> ${asset.localPath}`)
  ];
  return `${text.replace(/\n+$/, "")}\n${lines.join("\n")}\n`;
}
