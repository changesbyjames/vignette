import { z } from "zod";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, relative, resolve } from "node:path";

const CONTENT_TYPES = new Map(
  Object.entries({
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
  }),
);

/** Serve only GET and HEAD files inside the static root, with immutable caching reserved for asset URLs. */
export async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
): Promise<boolean> {
  if (!canServeMethod(request.method)) return false;
  if (request.url === undefined) return false;

  const url = new URL(request.url, "http://vignette.local");
  const pathname = decodePath(url.pathname);
  if (pathname === undefined) {
    response.statusCode = 400;
    response.end("Invalid URL path.");
    return true;
  }
  const filePath = resolveStaticPath(root, pathname);
  if (filePath === undefined) return false;
  const fileStat = await statOrMissing(filePath);
  if (fileStat === undefined || !fileStat.isFile()) return false;

  response.statusCode = 200;
  response.setHeader("Content-Length", fileStat.size);
  response.setHeader(
    "Content-Type",
    CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
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

function decodePath(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

/** Resolve inside the static root before opening a stream, rejecting traversal and null bytes. */
function resolveStaticPath(root: string, pathname: string): string | undefined {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, filePath);
  return pathFromRoot.startsWith("..") || pathFromRoot.includes("\0") ? undefined : filePath;
}

async function statOrMissing(filePath: string) {
  try {
    return await stat(filePath);
  } catch (cause) {
    if (z.object({ code: z.enum(["ENOENT", "ENOTDIR"]) }).safeParse(cause).success)
      return undefined;
    throw cause;
  }
}

function canServeMethod(method: string | undefined): boolean {
  return method === "GET" || method === "HEAD";
}
