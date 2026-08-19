import { describe, expect, it } from "vitest";
import {
  appendAssetLocalPathsFooter,
  appendAssetLocalPathsPlain,
  classifyAssetKind,
  normalizeAssetSrc,
  resolveAssetLocalPath
} from "../siyuan/assets.js";

describe("asset helpers", () => {
  it("normalizes asset src", () => {
    expect(normalizeAssetSrc("./assets/pic.png")).toBe("assets/pic.png");
    expect(normalizeAssetSrc("../secret")).toBeNull();
    expect(classifyAssetKind("assets/pic.png")).toBe("image");
    expect(classifyAssetKind("assets/note.pdf")).toBe("file");
  });

  it("resolves local path via SiYuan API", async () => {
    const client = {
      post: async (endpoint: string, body?: { path?: string }) => {
        if (endpoint === "/api/asset/resolveAssetPath") {
          expect(body?.path).toBe("assets/pic.png");
          return "D:/siyuan/data/assets/pic.png";
        }
        return null;
      }
    };
    await expect(resolveAssetLocalPath(client as never, "assets/pic.png")).resolves.toBe(
      "D:/siyuan/data/assets/pic.png"
    );
  });

  it("appends local paths to markdown footer", () => {
    const markdown = appendAssetLocalPathsFooter("# Title\n\nbody", [
      { src: "assets/pic.png", kind: "image", localPath: "D:/siyuan/data/assets/pic.png" }
    ]);
    expect(markdown).toContain("## 附件本地路径");
    expect(markdown).toContain("`assets/pic.png`");
    expect(markdown).toContain("`D:/siyuan/data/assets/pic.png`");
  });

  it("appends local paths to plain text", () => {
    const text = appendAssetLocalPathsPlain("Title body", [
      { src: "assets/pic.png", kind: "image", localPath: "D:/siyuan/data/assets/pic.png" }
    ]);
    expect(text).toContain("附件本地路径:");
    expect(text).toContain("assets/pic.png -> D:/siyuan/data/assets/pic.png");
  });
});
