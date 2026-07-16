import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, relative, resolve } from "node:path";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (request.url === undefined) return false;

  const url = new URL(request.url, "http://react-obs.local");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.statusCode = 400;
    response.end("Invalid URL path.");
    return true;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, filePath);
  if (pathFromRoot.startsWith("..") || pathFromRoot.includes("\0")) return false;

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error: unknown) {
    if (isMissingFile(error)) return false;
    throw error;
  }
  if (!fileStat.isFile()) return false;

  response.statusCode = 200;
  response.setHeader("Content-Length", fileStat.size);
  response.setHeader(
    "Content-Type",
    CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
  );
  response.setHeader(
    "Cache-Control",
    pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  );
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(filePath).pipe(response);
  return true;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "ENOENT" ||
      (error as { readonly code?: unknown }).code === "ENOTDIR")
  );
}
