import { describe, expect, it } from "vitest";
import { ensureWritableNotebook } from "../siyuan/guards.js";

describe("ensureWritableNotebook", () => {
  it("allows write in configured notebook", () => {
    const decision = ensureWritableNotebook("A", "A");
    expect(decision.allowed).toBe(true);
  });

  it("denies write in other notebook", () => {
    const decision = ensureWritableNotebook("A", "B");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("read-only");
  });
});
