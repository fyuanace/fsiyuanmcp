import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const configSchema = z.object({
  SIYUAN_BASE_URL: z.string().url(),
  SIYUAN_TOKEN: z.string().default(""),
  WRITABLE_NOTEBOOK_ID: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3900),
  BIND_HOST: z.string().default("127.0.0.1"),
  MCP_AUTH_ENABLED: z.coerce.boolean().default(true),
  MCP_BEARER_TOKEN: z.string().default("")
});

const fileConfigSchema = z.object({
  siyuanBaseUrl: z.string().url(),
  siyuanToken: z.string().default(""),
  writableNotebookId: z.string().min(1),
  port: z.number().int().positive().default(3900),
  bindHost: z.string().default("127.0.0.1"),
  mcpAuthEnabled: z.boolean().default(true),
  mcpBearerToken: z.string().default(""),
  showTopbarStatus: z.boolean().default(true),
  autoStartOnBoot: z.boolean().default(true),
  autoStartDelayMs: z.number().int().min(1000).max(2000).default(1500),
  mcpUrl: z.string().url().optional()
});

export type AppConfig = z.infer<typeof configSchema>;
export type RuntimeConfigFile = z.infer<typeof fileConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const fromFile = loadConfigFromFile(env.FSIYUANMCP_CONFIG);
  if (fromFile) {
    return fromFile;
  }

  const parsed = configSchema.safeParse({
    SIYUAN_BASE_URL: env.SIYUAN_BASE_URL,
    SIYUAN_TOKEN: env.SIYUAN_TOKEN ?? "",
    WRITABLE_NOTEBOOK_ID: env.WRITABLE_NOTEBOOK_ID,
    PORT: env.PORT ?? 3900,
    BIND_HOST: env.BIND_HOST ?? "127.0.0.1",
    MCP_AUTH_ENABLED: env.MCP_AUTH_ENABLED ?? "true",
    MCP_BEARER_TOKEN: env.MCP_BEARER_TOKEN ?? ""
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment config: ${issues}`);
  }
  return parsed.data;
}

export function loadConfigFromFile(configPath?: string): AppConfig | null {
  if (!configPath) {
    return null;
  }
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  const text = fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, "");
  const raw = JSON.parse(text) as unknown;
  const parsed = fileConfigSchema.parse(raw);
  return {
    SIYUAN_BASE_URL: parsed.siyuanBaseUrl,
    SIYUAN_TOKEN: parsed.siyuanToken,
    WRITABLE_NOTEBOOK_ID: parsed.writableNotebookId,
    PORT: parsed.port,
    BIND_HOST: parsed.bindHost,
    MCP_AUTH_ENABLED: parsed.mcpAuthEnabled,
    MCP_BEARER_TOKEN: parsed.mcpBearerToken
  };
}

export function parseRuntimeConfigFile(configPath: string): RuntimeConfigFile {
  const resolved = path.resolve(configPath);
  const text = fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, "");
  const raw = JSON.parse(text) as unknown;
  return fileConfigSchema.parse(raw);
}
