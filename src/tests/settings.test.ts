import { describe, expect, it } from "vitest";
import { validateSettings } from "../plugin/settings.js";

describe("settingsSchema", () => {
  it("applies defaults for topbar and autostart fields", () => {
    const parsed = validateSettings({
      mcpUrl: "http://127.0.0.1:3900/mcp",
      writableNotebookId: "abc"
    });
    expect(parsed.showTopbarStatus).toBe(true);
    expect(parsed.autoStartOnBoot).toBe(true);
    expect(parsed.autoStartDelayMs).toBe(1500);
  });

  it("rejects delay outside 1000-2000ms", () => {
    expect(() =>
      validateSettings({
        mcpUrl: "http://127.0.0.1:3900/mcp",
        writableNotebookId: "abc",
        autoStartDelayMs: 3000
      })
    ).toThrow();
  });
});
