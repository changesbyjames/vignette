/** Severity assigned to an authoring or compilation diagnostic. */
export type DiagnosticSeverity = "warning" | "error";

/** Stable machine-readable code for a Vignette diagnostic. */
export type DiagnosticCode =
  | "INVALID_SHOW_ID"
  | "INVALID_SCENE_ID"
  | "INVALID_SOURCE_ID"
  | "INVALID_LAYER_ID"
  | "INVALID_CANVAS"
  | "INVALID_LAYOUT_VALUE"
  | "INVALID_PROPS"
  | "LAYOUT_COMPILE_FAILED"
  | "DUPLICATE_SCENE_ID"
  | "DUPLICATE_SOURCE_ID"
  | "DUPLICATE_LAYER_ID"
  | "DUPLICATE_PLACEMENT"
  | "MISSING_SOURCE"
  | "MISSING_SERVE"
  | "MISSING_ASSET"
  | "UNKNOWN_ACTIVE_SCENE"
  | "LAYER_HAS_BOTH"
  | "INVALID_TREE"
  | "SHOW_IDENTITY_CHANGED";

/** Deterministic authoring or compilation problem, reported in composer status. */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly path: string;
  readonly relatedIds?: readonly string[];
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

/** Sorts diagnostics by path, then code, so reports are deterministic. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return [...diagnostics].sort((left, right) =>
    left.path === right.path
      ? left.code.localeCompare(right.code)
      : left.path.localeCompare(right.path),
  );
}
