import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "./config.js";
import { SiYuanClient } from "./siyuan/client.js";
import { McpToolsService } from "./mcp/tools.js";
import { MCP_INSTRUCTIONS, McpResourcesService } from "./mcp/resources.js";
import { getResourceTemplates } from "./mcp/catalog.js";
import { getPluginVersionInfo } from "./version.js";
import { SiYuanApiError, type LsNotebooksData } from "./siyuan/contracts.js";
import { ensureNotebookSelectable, validateSettings } from "./plugin/settings.js";
import { renderSettingsPage } from "./plugin/settings-ui.js";
import { McpRuntimeController } from "./plugin/runtime.js";
import { createMcpAuthMiddleware } from "./siyuan/auth.js";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function ok(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function fail(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

export type ServerContext = {
  config: AppConfig;
  client: SiYuanClient;
  toolsService: McpToolsService;
  resourcesService: McpResourcesService;
  runtime: McpRuntimeController;
  app: express.Express;
};

export function createServer(config: AppConfig): ServerContext {
  const client = new SiYuanClient(config.SIYUAN_BASE_URL, config.SIYUAN_TOKEN);
  const mcpBaseUrl = `http://${config.BIND_HOST}:${config.PORT}`;
  const toolsService = new McpToolsService(client, {
    writableNotebookId: config.WRITABLE_NOTEBOOK_ID,
    mcpBaseUrl,
    siyuanBaseUrl: config.SIYUAN_BASE_URL
  });
  const resourcesService = new McpResourcesService(client, config.WRITABLE_NOTEBOOK_ID);
  const mcpAuth = createMcpAuthMiddleware(config.MCP_AUTH_ENABLED, config.MCP_BEARER_TOKEN);
  const runtime = new McpRuntimeController({
    autoStartOnBoot: true,
    autoStartDelayMs: 1500,
    showTopbarStatus: true
  });

  const app = express();
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, runtime: runtime.getStatus(), ...getPluginVersionInfo(), pid: process.pid });
  });

  app.get("/version", (_req, res) => {
    res.json({ ok: true, ...getPluginVersionInfo(), pid: process.pid });
  });

  app.get("/settings/model", async (_req, res) => {
    try {
      const notebooks = await client.post<LsNotebooksData>("/api/notebook/lsNotebooks", {});
      const model = {
        mcpUrl: `http://127.0.0.1:${config.PORT}/mcp`,
        frontendVersion: getPluginVersionInfo().pluginVersion,
        backendVersion: getPluginVersionInfo().version,
        writableNotebookId: config.WRITABLE_NOTEBOOK_ID,
        showTopbarStatus: runtime.getOptions().showTopbarStatus,
        autoStartOnBoot: runtime.getOptions().autoStartOnBoot,
        autoStartDelayMs: runtime.getOptions().autoStartDelayMs,
        notebooks: notebooks.notebooks,
        toolGroups: toolsService.listGroups(),
        tools: toolsService.listTools(),
        resources: resourcesService.listResources(),
        connectivityStatus: "ok" as const,
        connectivityMessage: ""
      };
      res.json(model);
    } catch (error) {
      res.status(500).json({
        mcpUrl: `http://127.0.0.1:${config.PORT}/mcp`,
        frontendVersion: getPluginVersionInfo().pluginVersion,
        backendVersion: getPluginVersionInfo().version,
        writableNotebookId: config.WRITABLE_NOTEBOOK_ID,
        showTopbarStatus: runtime.getOptions().showTopbarStatus,
        autoStartOnBoot: runtime.getOptions().autoStartOnBoot,
        autoStartDelayMs: runtime.getOptions().autoStartDelayMs,
        notebooks: [],
        toolGroups: toolsService.listGroups(),
        tools: toolsService.listTools(),
        resources: resourcesService.listResources(),
        connectivityStatus: "error" as const,
        connectivityMessage: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/settings/preview", async (_req, res) => {
    try {
      const notebooks = await client.post<LsNotebooksData>("/api/notebook/lsNotebooks", {});
      const html = renderSettingsPage({
        mcpUrl: `http://127.0.0.1:${config.PORT}/mcp`,
        frontendVersion: getPluginVersionInfo().pluginVersion,
        backendVersion: getPluginVersionInfo().version,
        writableNotebookId: config.WRITABLE_NOTEBOOK_ID,
        showTopbarStatus: runtime.getOptions().showTopbarStatus,
        autoStartOnBoot: runtime.getOptions().autoStartOnBoot,
        autoStartDelayMs: runtime.getOptions().autoStartDelayMs,
        notebooks: notebooks.notebooks,
        toolGroups: toolsService.listGroups(),
        tools: toolsService.listTools(),
        resources: resourcesService.listResources(),
        connectivityStatus: "ok"
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error) {
      res.status(500).send(error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/settings/validate", async (req, res) => {
    try {
      const input = validateSettings(req.body);
      const notebooks = await client.post<LsNotebooksData>("/api/notebook/lsNotebooks", {});
      ensureNotebookSelectable(input.writableNotebookId, notebooks.notebooks);
      runtime.updateOptions({
        showTopbarStatus: input.showTopbarStatus,
        autoStartOnBoot: input.autoStartOnBoot,
        autoStartDelayMs: input.autoStartDelayMs
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });

  const handleMcpPost = async (req: express.Request, res: express.Response) => {
    const body = req.body as JsonRpcRequest | JsonRpcRequest[] | undefined;
    if (Array.isArray(body)) {
      return res.status(400).json(fail(null, -32600, "Batch requests are not supported"));
    }
    if (body && body.jsonrpc === "2.0" && !body.method && ("result" in body || "error" in body)) {
      return res.status(202).end();
    }
    if (!body || body.jsonrpc !== "2.0" || !body.method) {
      return res.status(400).json(fail(null, -32600, "Invalid Request"));
    }
    if (body.method.startsWith("notifications/")) {
      return res.status(202).end();
    }

    const startedAt = Date.now();
    try {
      if (body.method === "initialize") {
        const requested = String((body.params as { protocolVersion?: string } | undefined)?.protocolVersion ?? "");
        const protocolVersion = ["2024-11-05", "2025-03-26", "2025-06-18"].includes(requested)
          ? requested
          : "2025-03-26";
        return res.json(
          ok(body.id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: {} },
            serverInfo: { name: "siyuan-http-mcp", version: getPluginVersionInfo().version },
            instructions: MCP_INSTRUCTIONS
          })
        );
      }
      if (body.method === "ping") {
        return res.json(ok(body.id, {}));
      }
      if (body.method === "tools/list") {
        return res.json(ok(body.id, { tools: toolsService.listTools() }));
      }
      if (body.method === "resources/list") {
        return res.json(ok(body.id, { resources: resourcesService.listResources() }));
      }
      if (body.method === "resources/templates/list") {
        return res.json(ok(body.id, { resourceTemplates: getResourceTemplates() }));
      }
      if (body.method === "resources/read") {
        const uri = String((body.params as { uri?: string } | undefined)?.uri ?? "");
        const contents = await resourcesService.readResource(uri);
        return res.json(ok(body.id, { contents: [contents] }));
      }
      if (body.method === "prompts/list") {
        return res.json(ok(body.id, { prompts: [] }));
      }
      if (body.method === "tools/call") {
        const toolName = String(body.params?.name ?? "");
        const args = body.params?.arguments ?? {};
        const data = await toolsService.callTool(toolName, args);
        return res.json(ok(body.id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }));
      }
      return res.json(fail(body.id, -32601, "Method not found"));
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      const detail =
        error instanceof SiYuanApiError
          ? { endpoint: error.endpoint, code: error.code, detail: error.detail }
          : undefined;
      return res.json(fail(body.id, -32000, `${message}`, { elapsedMs, ...detail }));
    }
  };

  app.get("/mcp", mcpAuth, (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(": connected\n\n");
    const timer = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);
    const close = () => {
      clearInterval(timer);
    };
    req.on("close", close);
    res.on("close", close);
  });

  app.delete("/mcp", mcpAuth, (_req, res) => {
    res.status(405).end();
  });

  app.post("/mcp", mcpAuth, handleMcpPost);

  app.get("/topbar/status", (_req, res) => {
    res.json({
      ...runtime.getTopbarView(),
      runtime: runtime.getStatus()
    });
  });

  return { config, client, toolsService, resourcesService, runtime, app };
}

export async function startServer(config: AppConfig): Promise<ServerContext> {
  const context = createServer(config);
  context.runtime.markStarting();

  await new Promise<void>((resolve, reject) => {
    context.app.listen(config.PORT, config.BIND_HOST, () => {
      context.runtime.markRunning();
      resolve();
    }).on("error", reject);
  });

  context.runtime.scheduleReadyCheck(async () => {
    await context.toolsService.validateWritableNotebookExists();
  });

  return context;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const context = await startServer(config);
  // eslint-disable-next-line no-console
  console.log(`siyuan-http-mcp running on http://${context.config.BIND_HOST}:${context.config.PORT}`);
}

const entryPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const shouldAutostart = process.env.FSIYUANMCP_AUTOSTART === "1" || entryPath === invokedPath;
if (shouldAutostart) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("failed to start server", error);
    process.exitCode = 1;
  });
}
