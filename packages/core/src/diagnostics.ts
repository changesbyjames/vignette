/** Severity assigned to an authoring or compilation diagnostic. */
export type DiagnosticSeverity = "warning" | "error";

/** Stable machine-readable code for a Vignette diagnostic. */
export type DiagnosticCode =
  | "INVALID_PROJECT_ID"
  | "INVALID_SCENE_ID"
  | "INVALID_SOURCE_ID"
  | "INVALID_LAYER_ID"
  | "INVALID_CANVAS"
  | "INVALID_LAYOUT_VALUE"
  | "LAYOUT_COMPILE_FAILED"
  | "INVALID_ASSET_NAME"
  | "INVALID_BROWSER_URL"
  | "INVALID_SOURCE_SIZE"
  | "INVALID_SOURCE_SETTING"
  | "UNKNOWN_SOURCE_KIND"
  | "DUPLICATE_SCENE_ID"
  | "DUPLICATE_SOURCE_ID"
  | "DUPLICATE_LAYER_ID"
  | "MISSING_SOURCE"
  | "MISSING_SCENE"
  | "SCENE_CYCLE"
  | "V1_REPEATED_PLACEMENT"
  | "TARGET_LAYOUT_DIVERGENCE"
  | "UNREACHABLE_SOURCE"
  | "UNSUPPORTED_TARGET_CAPABILITY";

/** Deterministic authoring or compilation problem. */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly path: string;
  readonly relatedIds?: readonly string[];
}

/** Diagnostics grouped by severity after authoring validation. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly errors: readonly Diagnostic[];
  readonly warnings: readonly Diagnostic[];
}

/** Creates a diagnostic, omitting related IDs when none are provided. */
export function diagnostic(
  code: DiagnosticCode,
  severity: DiagnosticSeverity,
  path: string,
  message: string,
  relatedIds?: readonly string[],
): Diagnostic {
  return relatedIds === undefined
    ? { code, severity, path, message }
    : { code, severity, path, message, relatedIds };
}
