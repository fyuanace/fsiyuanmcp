import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

export type PluginVersionInfo = {
  name: string;
  version: string;
  pluginVersion: string;
  serverName: string;
};

let cached: PluginVersionInfo | undefined;

export function getPluginVersionInfo(): PluginVersionInfo {
  if (cached) {
    return cached;
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const plugin = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")) as { version?: string };
  cached = {
    name: pkg.name,
    version: pkg.version,
    pluginVersion: String(plugin.version ?? pkg.version),
    serverName: "siyuan-http-mcp"
  };
  return cached;
}
