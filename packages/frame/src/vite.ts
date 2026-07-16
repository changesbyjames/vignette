/**
 * Vite plugin and development module host for discovering and serving Vignette frames.
 *
 * @module
 */
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

import type { FrameMetadata } from "./definition.js";
import { hashFrameValue } from "./serialization.js";
import { createFrameRequestHandler, FrameRouteRegistry, type ModuleHost } from "./server.js";

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export { FrameRouteRegistry } from "./server.js";

/**
 * The development binding of the ModuleHost seam: modules load through Vite's SSR pipeline and
 * client URLs are the dev-server module URLs, with the hydration helper served via `/@fs/`.
 */
export function createDevServerModuleHost(server: ViteDevServer): ModuleHost {
  const clientPath = normalizePath(fileURLToPath(new URL("./client.js", import.meta.url)));
  return {
    loadModule: (moduleUrl) => server.ssrLoadModule(moduleUrl),
    resolveClientModule: (moduleUrl) => moduleUrl,
    resolveClientHelper: () => `/@fs/${clientPath}`,
  };
}

/** Creates the Vite plugin that discovers, serves, and transforms frame modules. */
export function vignetteFrames(registry: FrameRouteRegistry = new FrameRouteRegistry()): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: "vignette-frames",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
    },
    transform(code, id) {
      if (config === undefined) throw new Error("Vite config was not resolved before transform.");
      const cleanId = id.split("?", 1)[0];
      if (cleanId === undefined || cleanId.includes(`${sep}node_modules${sep}`)) return null;
      return transformFrameModule(code, cleanId, config.root, registry);
    },
    configureServer(server) {
      const handleRequest = createFrameRequestHandler(createDevServerModuleHost(server), registry);
      server.middlewares.use((request, response, next) => {
        void handleRequest(request, response).then(
          (handled) => {
            if (!handled) next();
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
  };
}

/** Injects deterministic client metadata into exported `frame()` definitions. */
export function transformFrameModule(
  code: string,
  id: string,
  root: string,
  registrations: FrameRouteRegistry = new FrameRouteRegistry(),
): { readonly code: string; readonly map: null } | null {
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, scriptKind(id));
  const frameImports = findFrameImportNames(source);
  if (frameImports.size === 0) return null;
  const moduleUrl = toModuleUrl(id, root);
  const replacements: Replacement[] = [];

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const call = unwrapExpression(declaration.initializer);
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      if (!frameImports.has(call.expression.text)) continue;
      const exportName = declaration.name.text;
      const routeKey = `${slug(exportName)}-${hashFrameValue(`${moduleUrl}#${exportName}`)}`;
      const metadata: FrameMetadata = { routeKey, moduleUrl, exportName };
      registrations.registerFromTransform(metadata);
      replacements.push({
        start: call.expression.getStart(source),
        end: call.expression.getEnd(),
        text: `${call.expression.text}.__withMetadata(${JSON.stringify(metadata)})`,
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
    if (statement.moduleSpecifier.text !== "@cbj/vignette-frame") continue;
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

function toModuleUrl(id: string, root: string): string {
  const relativeId = relative(root, id);
  if (!relativeId.startsWith("..") && !relativeId.startsWith(sep)) {
    return `/${normalizePath(relativeId)}`;
  }
  return `/@fs/${normalizePath(id)}`;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
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
