const MCP_SERVER_NAME = "fsiyuanmcp";

const CLIENTS = [
  { id: "cursor-json", label: "Cursor / 通用 JSON" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cherry-studio", label: "Cherry Studio" },
  { id: "opencode", label: "OpenCode" }
];

const TRANSPORTS = [{ id: "http", label: "HTTP/HTTPS" }];

function getMcpUrl(port, transport = "http") {
  const scheme = transport === "https" ? "https" : "http";
  return `${scheme}://127.0.0.1:${port}/mcp`;
}

function buildHttpEntry(port, transport, token, authEnabled) {
  const entry = { url: getMcpUrl(port, transport) };
  if (authEnabled && token) {
    entry.headers = { Authorization: `Bearer ${token}` };
  }
  return entry;
}

function buildConfig(clientId, transport, port, token, authEnabled = true) {
  const url = getMcpUrl(port, transport);
  const effectiveToken = authEnabled ? token : "";
  switch (clientId) {
    case "claude-code": {
      let toml = `[mcp_servers.${MCP_SERVER_NAME}]\nurl = "${url}"\nenabled = true\n`;
      if (effectiveToken) {
        toml += `http_headers = { "Authorization" = "Bearer ${effectiveToken}" }\n`;
      }
      return toml.trim();
    }
    case "opencode": {
      const payload = {
        $schema: "https://opencode.ai/config.json",
        mcp: {
          [MCP_SERVER_NAME]: {
            type: "remote",
            url,
            enabled: true
          }
        }
      };
      if (effectiveToken) {
        payload.mcp[MCP_SERVER_NAME].headers = { Authorization: `Bearer ${effectiveToken}` };
      }
      return JSON.stringify(payload, null, 2);
    }
    case "cherry-studio":
    case "cursor-json":
    default:
      return JSON.stringify(
        { mcpServers: { [MCP_SERVER_NAME]: buildHttpEntry(port, transport, effectiveToken, authEnabled) } },
        null,
        2
      );
  }
}

module.exports = {
  MCP_SERVER_NAME,
  CLIENTS,
  TRANSPORTS,
  getMcpUrl,
  buildConfig
};
