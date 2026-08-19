import http from "node:http";
import https from "node:https";
import { SiYuanApiError, type SiYuanApiResponse } from "./contracts.js";

type RequestInitWithTimeout = RequestInit & { timeoutMs?: number };

function isLocalHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export function shouldRelaxTls(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

export class SiYuanClient {
  public readonly baseUrl: string;
  private readonly token: string;

  public constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  public async getRaw(pathname: string): Promise<{ buffer: Buffer; contentType: string }> {
    const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const { statusCode, headers, buffer } = await this.requestBuffer("GET", normalized);
    if (statusCode < 200 || statusCode >= 300) {
      throw new SiYuanApiError(normalized, `HTTP ${statusCode}`);
    }
    const contentType = headers["content-type"] || "application/octet-stream";
    return { buffer, contentType: Array.isArray(contentType) ? contentType[0] : contentType };
  }

  public async post<T>(endpoint: string, body: object, init?: RequestInitWithTimeout): Promise<T> {
    try {
      const { statusCode, buffer } = await this.requestBuffer("POST", endpoint, JSON.stringify(body), init?.timeoutMs ?? 10000);
      if (statusCode < 200 || statusCode >= 300) {
        throw new SiYuanApiError(endpoint, `HTTP ${statusCode}`);
      }
      const payload = JSON.parse(buffer.toString("utf8")) as SiYuanApiResponse<T>;
      if (payload.code !== 0) {
        throw new SiYuanApiError(endpoint, `SiYuan API error`, payload.code, payload.msg);
      }
      return payload.data;
    } catch (error) {
      if (error instanceof SiYuanApiError) {
        throw error;
      }
      if (error instanceof Error && (error.name === "AbortError" || error.message === "Request timeout")) {
        throw new SiYuanApiError(endpoint, "Request timeout");
      }
      throw new SiYuanApiError(endpoint, "Unexpected request failure", undefined, String(error));
    }
  }

  private requestBuffer(
    method: "GET" | "POST",
    pathname: string,
    body?: string,
    timeoutMs = 10000
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; buffer: Buffer }> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    const transport = url.protocol === "https:" ? https : http;
    const headers: http.OutgoingHttpHeaders = {
      ...(this.token ? { Authorization: `Token ${this.token}` } : {})
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body ?? "");
    }

    return new Promise((resolve, reject) => {
      const req = transport.request(
        url,
        {
          method,
          headers,
          rejectUnauthorized: !shouldRelaxTls(this.baseUrl)
        } as https.RequestOptions,
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: response.headers,
              buffer: Buffer.concat(chunks)
            });
          });
        }
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("Request timeout"));
      });
      req.on("error", reject);
      if (method === "POST") {
        req.write(body ?? "");
      }
      req.end();
    });
  }
}
