import type { Request, Response, NextFunction } from "express";

function readProvidedToken(req: Request): string {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }
  const queryToken = req.query?.token;
  if (typeof queryToken === "string") {
    return queryToken;
  }
  return "";
}

export function createMcpAuthMiddleware(authEnabled: boolean, bearerToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!authEnabled || !bearerToken) {
      next();
      return;
    }
    if (readProvidedToken(req) === bearerToken) {
      next();
      return;
    }
    res.status(401).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32003, message: "Unauthorized: invalid or missing Bearer token" }
    });
  };
}
