import { describe, expect, it } from "vitest";
import { createServer } from "../server.js";
import type { AddressInfo } from "node:net";

function testConfig(port = 3998) {
  return {
    SIYUAN_BASE_URL: "http://127.0.0.1:6806",
    SIYUAN_TOKEN: "",
    WRITABLE_NOTEBOOK_ID: "nb1",
    PORT: port,
    BIND_HOST: "127.0.0.1",
    MCP_AUTH_ENABLED: true,
    MCP_BEARER_TOKEN: "secret"
  };
}

async function listen(app: ReturnType<typeof createServer>["app"]): Promise<{ close: () => Promise<void>; origin: string }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

describe("MCP streamable HTTP", () => {
  it("initializes and lists tools over POST", async () => {
    const ctx = createServer(testConfig());
    const { origin, close } = await listen(ctx.app);
    try {
      const initRes = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cursor", version: "1" } }
        })
      });
      expect(initRes.status).toBe(200);
      const initBody = (await initRes.json()) as { result: { protocolVersion: string } };
      expect(initBody.result.protocolVersion).toBe("2025-03-26");

      const notifyRes = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
      });
      expect(notifyRes.status).toBe(202);

      const listRes = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      });
      const listBody = (await listRes.json()) as { result: { tools: Array<{ name: string }> } };
      expect(listBody.result.tools.some((tool) => tool.name === "save_note")).toBe(true);
      expect(listBody.result.tools.some((tool) => tool.name === "delete_content")).toBe(true);
      expect(listBody.result.tools.some((tool) => tool.name === "create_doc")).toBe(false);
      expect(listBody.result.tools.some((tool) => tool.name === "list_notebooks_readonly")).toBe(false);

      const resourceRes = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/list", params: {} })
      });
      const resourceBody = (await resourceRes.json()) as { result: { resources: Array<{ uri: string }> } };
      expect(resourceBody.result.resources.some((item) => item.uri === "siyuan://tags")).toBe(true);
      expect(resourceBody.result.resources.some((item) => item.uri === "siyuan://categories")).toBe(false);
    } finally {
      await close();
    }
  });

  it("exposes GET /version without MCP auth", async () => {
    const ctx = createServer(testConfig());
    const { origin, close } = await listen(ctx.app);
    try {
      const res = await fetch(`${origin}/version`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; version: string; pluginVersion: string; pid: number };
      expect(body.ok).toBe(true);
      expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(body.pluginVersion).toBe(body.version);
      expect(body.pid).toBe(process.pid);

      const health = await fetch(`${origin}/healthz`);
      const healthBody = (await health.json()) as { ok: boolean; version: string };
      expect(healthBody.ok).toBe(true);
      expect(healthBody.version).toBe(body.version);
    } finally {
      await close();
    }
  });

  it("opens GET /mcp as an SSE stream", async () => {
    const ctx = createServer(testConfig());
    const { origin, close } = await listen(ctx.app);
    try {
      const res = await fetch(`${origin}/mcp`, {
        method: "GET",
        headers: {
          Authorization: "Bearer secret",
          Accept: "text/event-stream"
        }
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      await res.body?.cancel();
    } finally {
      await close();
    }
  });
});
