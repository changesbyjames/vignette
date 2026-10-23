/** Injects build metadata into exported `frame()` definitions, using Vite's own TSX parser. */
import { createHash } from "node:crypto";

import type { FrameMetadata } from "@strangecyan/vignette-frame";
import { parseSync, type ESTree } from "vite";

const FRAME_PACKAGE = "@strangecyan/vignette-frame";

interface FrameCall {
  readonly exportName: string;
  readonly callee: ESTree.IdentifierReference;
}

/** The rewritten module and the metadata of each frame it exports. */
export interface FrameTransformResult {
  readonly code: string;
  readonly metadata: readonly FrameMetadata[];
}

/**
 * Rewrites each exported `frame(...)` call to `frame.withMetadata({...})(...)`, or returns null
 * when the module exports no frames. Only calls to a named `frame` import from the frame package
 * count, including aliased imports, and the call may be wrapped in parentheses, `as`,
 * `satisfies`, or `!`.
 */
export function transformFrameDefinitions(
  code: string,
  file: string,
  moduleUrl: string,
): FrameTransformResult | null {
  if (!code.includes(FRAME_PACKAGE)) return null;
  const parsed = parseSync(file, code);
  // Leave syntax errors for Vite's own transform to report with full context.
  if (parsed.errors.length > 0) return null;
  const calls = exportedFrameCalls(parsed.program, frameImportNames(parsed.program));
  if (calls.length === 0) return null;

  const metadata = calls.map((call) => frameMetadata(moduleUrl, call.exportName));
  let transformed = code;
  // Splice from the end so earlier offsets stay valid.
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const { callee } = calls[index] ?? unreachable();
    const replacement = `${callee.name}.withMetadata(${JSON.stringify(metadata[index])})`;
    transformed = transformed.slice(0, callee.start) + replacement + transformed.slice(callee.end);
  }
  return { code: transformed, metadata };
}

/** Deterministic route metadata for one exported frame. */
export function frameMetadata(moduleUrl: string, exportName: string): FrameMetadata {
  const hash = createHash("sha256").update(`${moduleUrl}#${exportName}`).digest("hex").slice(0, 8);
  const slug = exportName.replaceAll(/[^A-Za-z0-9_-]/gu, "-").toLowerCase();
  return { routeKey: `${slug}-${hash}`, moduleUrl, exportName };
}

/** Exported `const name = factory(...)` declarations, in source order. */
function exportedFrameCalls(
  program: ESTree.Program,
  factories: ReadonlySet<string>,
): readonly FrameCall[] {
  if (factories.size === 0) return [];
  const calls: FrameCall[] = [];
  for (const statement of program.body) {
    for (const declarator of exportedDeclarators(statement)) {
      const call = frameCall(declarator, factories);
      if (call !== undefined) calls.push(call);
    }
  }
  return calls;
}

/** A declarator binding one identifier to a call of a frame factory, looking through wrappers. */
function frameCall(
  declarator: ESTree.VariableDeclarator,
  factories: ReadonlySet<string>,
): FrameCall | undefined {
  if (declarator.id.type !== "Identifier" || declarator.init === null) return undefined;
  const call = unwrap(declarator.init);
  if (call.type !== "CallExpression" || call.callee.type !== "Identifier") return undefined;
  if (!factories.has(call.callee.name)) return undefined;
  return { exportName: declarator.id.name, callee: call.callee };
}

/** Local names bound to the frame factory by value imports from the frame package. */
function frameImportNames(program: ESTree.Program): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (!isFramePackageImport(statement)) continue;
    for (const specifier of statement.specifiers) {
      if (importsFrameFactory(specifier)) names.add(specifier.local.name);
    }
  }
  return names;
}

function isFramePackageImport(
  statement: ESTree.Program["body"][number],
): statement is ESTree.ImportDeclaration {
  return (
    statement.type === "ImportDeclaration" &&
    statement.importKind !== "type" &&
    statement.source.value === FRAME_PACKAGE
  );
}

/** A value specifier importing `frame`, whether written as an identifier or a string name. */
function importsFrameFactory(
  specifier: ESTree.ImportDeclarationSpecifier,
): specifier is ESTree.ImportSpecifier {
  if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") return false;
  const imported =
    specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
  return imported === "frame";
}

function exportedDeclarators(
  statement: ESTree.Program["body"][number],
): readonly ESTree.VariableDeclarator[] {
  if (statement.type !== "ExportNamedDeclaration") return [];
  const declaration = statement.declaration;
  return declaration?.type === "VariableDeclaration" ? declaration.declarations : [];
}

/** Look through wrappers that do not change which call produces the value. */
function unwrap(expression: ESTree.Expression): ESTree.Expression {
  switch (expression.type) {
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return unwrap(expression.expression);
    default:
      return expression;
  }
}

function unreachable(): never {
  throw new Error("Frame call index out of range.");
}
