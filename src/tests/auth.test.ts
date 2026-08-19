import { describe, expect, it } from "vitest";
import { createMcpAuthMiddleware } from "../siyuan/auth.js";

describe("createMcpAuthMiddleware", () => {
  it("allows request when auth disabled", () => {
    let called = false;
    const middleware = createMcpAuthMiddleware(false, "secret");
    const req = { headers: {} } as never;
    const res = { status: () => ({ json: () => undefined }) } as never;
    middleware(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("rejects missing bearer token when auth enabled", () => {
    let statusCode = 0;
    const middleware = createMcpAuthMiddleware(true, "secret");
    const req = { headers: {} } as never;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return { json: () => undefined };
      }
    } as never;
    middleware(req, res, () => undefined);
    expect(statusCode).toBe(401);
  });

  it("allows query token for asset access", () => {
    let called = false;
    const middleware = createMcpAuthMiddleware(true, "secret");
    const req = { headers: {}, query: { token: "secret" } } as never;
    const res = { status: () => ({ json: () => undefined }) } as never;
    middleware(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});
