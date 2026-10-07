/**
 * Server resources referenced by snapshots and asset manifests use one of two URL forms:
 *
 * - an absolute `http:` or `https:` URL, which every target uses unchanged; or
 * - a root-relative path beginning with exactly one `/` (e.g. `/__vignette/frame/...`), which
 *   each target resolves against its own configured base URL.
 *
 * Protocol-relative (`//host/...`), bare relative (`assets/logo.png`), and other schemes are
 * rejected so a composer never needs to know its public origin and a target never guesses one.
 */
const PROBE_ORIGIN = "http://vignette.invalid";

/** Returns true for a root-relative resource URL such as `/assets/logo.png`. */
export function isRootRelativeUrl(url: string): boolean {
  if (!url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return false;
  // WHATWG parsing strips tabs/newlines and treats backslashes specially; require that the
  // path cannot escape the base origin once parsed.
  if (/[\t\n\r]/u.test(url) || url !== url.trim()) return false;
  try {
    return new URL(url, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

/** Returns true for an absolute HTTP(S) URL. */
export function isAbsoluteHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isAbsoluteUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Returns an error message unless `url` is an absolute HTTP(S) URL or a root-relative path. */
export function validateResourceUrl(url: string): string | undefined {
  if (isAbsoluteHttpUrl(url) || isRootRelativeUrl(url)) return undefined;
  if (url.startsWith("//")) return "URL must not be protocol-relative ('//host').";
  return "URL must be an absolute HTTP(S) URL or a root-relative path starting with a single '/'.";
}

/**
 * Resolves a snapshot or manifest resource URL for a target. Root-relative URLs are resolved
 * against the origin of `baseUrl`; other absolute URLs are returned unchanged (which forms are
 * allowed is checked separately by `validateResourceUrl`). Throws a `TypeError` for unparseable
 * URLs and for root-relative URLs without a base.
 */
export function resolveResourceUrl(url: string, baseUrl: string | undefined): string {
  if (!isRootRelativeUrl(url)) {
    if (isAbsoluteUrl(url)) return url;
    throw new TypeError(`Resource URL '${url}' is invalid: ${validateResourceUrl(url) ?? ""}`);
  }
  if (baseUrl === undefined) {
    throw new TypeError(`Resource URL '${url}' is root-relative but no base URL is configured.`);
  }
  return new URL(url, baseUrl).href;
}

/** Validates a target base URL option, throwing a `TypeError` unless it is absolute HTTP(S). */
export function requireBaseUrl(baseUrl: string, option = "baseUrl"): string {
  if (!isAbsoluteHttpUrl(baseUrl)) {
    throw new TypeError(`${option} must be an absolute HTTP(S) URL; received '${baseUrl}'.`);
  }
  return baseUrl;
}
