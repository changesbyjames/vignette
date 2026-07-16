import type { ObsPlan } from "./operations.js";

export type ObsDiagnosticCode =
  | "OBS_MISSING_REQUEST"
  | "OBS_UNSUPPORTED_SOURCE"
  | "OBS_INPUT_KIND_MISMATCH"
  | "OBS_AMBIGUOUS_PLACEMENT"
  | "OBS_UNSUPPORTED_FEATURE"
  | "OBS_INVALID_PLAN";

export interface ObsDiagnostic {
  readonly code: ObsDiagnosticCode;
  readonly severity: "warning" | "error";
  readonly path: string;
  readonly message: string;
  readonly relatedIds?: readonly string[];
}

export type ObsPlanningResult =
  | { readonly ok: true; readonly plan: ObsPlan; readonly diagnostics: readonly ObsDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly ObsDiagnostic[] };

export function obsDiagnostic(
  code: ObsDiagnosticCode,
  severity: ObsDiagnostic["severity"],
  path: string,
  message: string,
  relatedIds?: readonly string[],
): ObsDiagnostic {
  return relatedIds === undefined
    ? { code, severity, path, message }
    : { code, severity, path, message, relatedIds };
}
