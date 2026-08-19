import { describe, expect, it } from "vitest";
import { buildConfig } from "../../client-config.js";

describe("client-config", () => {
  it("builds cursor json config", () => {
    const text = buildConfig("cursor-json", "http", 3900, "abc");
    const parsed = JSON.parse(text);
    expect(parsed.mcpServers.fsiyuanmcp.url).toBe("http://127.0.0.1:3900/mcp");
    expect(parsed.mcpServers.fsiyuanmcp.headers.Authorization).toBe("Bearer abc");
  });

  it("builds cursor json config without token when auth disabled", () => {
    const text = buildConfig("cursor-json", "http", 3900, "abc", false);
    const parsed = JSON.parse(text);
    expect(parsed.mcpServers.fsiyuanmcp.url).toBe("http://127.0.0.1:3900/mcp");
    expect(parsed.mcpServers.fsiyuanmcp.headers).toBeUndefined();
  });
});
