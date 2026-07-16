export interface AssetRef {
  readonly kind: "asset";
  readonly name: string;
}

export function asset(name: string): AssetRef {
  return { kind: "asset", name };
}

export type AssetTargetKind = "dom" | "obs";

export interface AssetResolutionContext {
  readonly targetId: string;
  readonly targetKind: AssetTargetKind;
}

export type ResolvedAsset =
  { readonly kind: "url"; readonly url: string } | { readonly kind: "file"; readonly path: string };

export interface AssetResolver {
  resolve(asset: AssetRef, context: AssetResolutionContext): Promise<ResolvedAsset>;
}

export function validateAssetName(name: string): string | undefined {
  if (name.length === 0) return "Asset name must not be empty.";
  if (name !== name.trim()) return "Asset name must not have surrounding whitespace.";
  if (name.startsWith("/") || name.startsWith("\\")) {
    return "Asset name must be project-relative.";
  }
  if (/^[A-Za-z]:/u.test(name)) return "Asset name must not contain a drive prefix.";
  if (name.includes("\\")) return "Asset name must use POSIX '/' separators.";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(name)) {
    return "Asset name must not contain a URL scheme.";
  }

  const segments = name.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return "Asset name must be normalized and must not contain empty, '.' or '..' segments.";
  }

  return undefined;
}
