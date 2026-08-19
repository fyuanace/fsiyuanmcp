import { describe, expect, it } from "vitest";
import { getPluginVersionInfo } from "../version.js";

describe("getPluginVersionInfo", () => {
  it("reads package and plugin versions from project root", () => {
    const info = getPluginVersionInfo();
    expect(info.name).toBe("fsiyuanmcp");
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(info.pluginVersion).toBe(info.version);
    expect(info.serverName).toBe("siyuan-http-mcp");
  });
});
