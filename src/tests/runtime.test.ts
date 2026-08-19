import { describe, expect, it } from "vitest";
import { McpRuntimeController } from "../plugin/runtime.js";

describe("McpRuntimeController", () => {
  it("hides topbar when disabled", () => {
    const runtime = new McpRuntimeController({
      autoStartOnBoot: false,
      autoStartDelayMs: 1000,
      showTopbarStatus: false
    });
    const topbar = runtime.getTopbarView();
    expect(topbar.visible).toBe(false);
  });

  it("marks running and error states", () => {
    const runtime = new McpRuntimeController({
      autoStartOnBoot: true,
      autoStartDelayMs: 1000,
      showTopbarStatus: true
    });
    runtime.markStarting();
    expect(runtime.getStatus().status).toBe("starting");
    runtime.markRunning();
    expect(runtime.getStatus().status).toBe("running");
    runtime.markError(new Error("boom"));
    expect(runtime.getStatus().status).toBe("error");
  });
});
