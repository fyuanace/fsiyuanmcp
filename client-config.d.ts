export function buildConfig(
  clientId: string,
  transport: string,
  port: number,
  token: string,
  authEnabled?: boolean
): string;

export const MCP_SERVER_NAME: string;
export const CLIENTS: Array<{ id: string; label: string }>;
export const TRANSPORTS: Array<{ id: string; label: string }>;
