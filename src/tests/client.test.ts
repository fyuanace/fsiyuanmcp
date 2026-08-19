import { describe, expect, it } from "vitest";
import { shouldRelaxTls } from "../siyuan/client.js";

describe("shouldRelaxTls", () => {
  it("relaxes only local https kernel", () => {
    expect(shouldRelaxTls("https://127.0.0.1:50175")).toBe(true);
    expect(shouldRelaxTls("https://localhost:6806")).toBe(true);
    expect(shouldRelaxTls("http://127.0.0.1:6806")).toBe(false);
    expect(shouldRelaxTls("https://example.com")).toBe(false);
  });
});
