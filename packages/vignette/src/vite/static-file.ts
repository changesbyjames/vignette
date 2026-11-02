import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".svg", "image/svg+xml"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".woff2", "font/woff2"],
]);

/**
 * Streams the file `name` (a URL-encoded path) from inside `dir`. Resolves false, without
 * responding, when the name escapes `dir` or is not a file.
 */
export async function sendFile(
  dir: string,
  name: string,
  response: ServerResponse,
): Promise<boolean> {
  const root = resolve(dir);
  let file = "";
  try {
    file = resolve(root, decodeURIComponent(name));
  } catch {
    return false;
  }
  const inside = relative(root, file);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
    return false;
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES.get(extname(file).toLowerCase()) ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(file).pipe(response);
  return true;
}
