/** Platform-neutral source transform for exported frame definitions. */
import ts from "typescript";

import type { FrameMetadata } from "./definition.js";
import { hashFrameValue } from "./serialization.js";

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface FrameTransformOptions {
  /** Source identifier used to select the TypeScript/JSX parser. */
  readonly id: string;
  /** Public module URL used by the hydration host. */
  readonly moduleUrl: string;
  readonly onMetadata?: (metadata: FrameMetadata) => void;
}

/** Injects deterministic client metadata into exported `frame()` definitions. */
export function transformFrameDefinitions(
  code: string,
  options: FrameTransformOptions,
): { readonly code: string; readonly map: null } | null {
  const source = ts.createSourceFile(
    options.id,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(options.id),
  );
  const frameImports = findFrameImportNames(source);
  if (frameImports.size === 0) return null;
  const replacements: Replacement[] = [];

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const call = unwrapExpression(declaration.initializer);
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      if (!frameImports.has(call.expression.text)) continue;
      const exportName = declaration.name.text;
      const routeKey = `${slug(exportName)}-${hashFrameValue(`${options.moduleUrl}#${exportName}`)}`;
      const metadata: FrameMetadata = { routeKey, moduleUrl: options.moduleUrl, exportName };
      options.onMetadata?.(metadata);
      replacements.push({
        start: call.expression.getStart(source),
        end: call.expression.getEnd(),
        text: `${call.expression.text}.withMetadata(${JSON.stringify(metadata)})`,
      });
    }
  }

  if (replacements.length === 0) return null;
  let transformed = code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.text +
      transformed.slice(replacement.end);
  }
  return { code: transformed, map: null };
}

function findFrameImportNames(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "@strangecyan/vignette-frame") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "frame")
        names.add(element.name.text);
    }
  }
  return names;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function hasExportModifier(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

function slug(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/gu, "-").toLowerCase();
}

function scriptKind(id: string): ts.ScriptKind {
  if (id.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (id.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (id.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}
