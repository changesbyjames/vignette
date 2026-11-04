import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Requires a doc comment on at least 80% of the project-owned symbols `@strangecyan/vignette` exports.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = "packages/vignette";
const minimumCoverage = 0.8;

const manifest = JSON.parse(readFileSync(resolve(root, directory, "package.json"), "utf8"));
const entrypoints = Object.values(manifest.exports).map(({ types }) => sourceEntrypoint(types));
const program = ts.createProgram(entrypoints, {
  allowJs: false,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2023,
});
const checker = program.getTypeChecker();
const symbols = new Map();

for (const entrypoint of entrypoints) {
  // Every symbol an entry exports that is declared in this package (not re-exported from a
  // dependency) counts, keyed by its exported name.
  const source = program.getSourceFile(entrypoint);
  if (source === undefined) throw new Error(`TypeScript did not load ${entrypoint}.`);
  const module = checker.getSymbolAtLocation(source);
  if (module === undefined && source.isDeclarationFile) continue;
  if (module === undefined)
    throw new Error(`TypeScript did not resolve exports for ${entrypoint}.`);
  for (const exported of checker.getExportsOfModule(module)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const declarations = symbol.getDeclarations() ?? [];
    const declaration = declarations.find((candidate) =>
      candidate.getSourceFile().fileName.includes(directory),
    );
    if (declaration === undefined) continue;
    const documentation = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
    const file = declaration.getSourceFile();
    const { line } = file.getLineAndCharacterOfPosition(declaration.getStart());
    symbols.set(exported.getName(), {
      documented: documentation.length > 0,
      location: `${file.fileName.slice(root.length + 1)}:${String(line + 1)}`,
    });
  }
}

const entries = [...symbols.entries()];
const documented = entries.filter(([, symbol]) => symbol.documented).length;
const coverage = entries.length === 0 ? 1 : documented / entries.length;
console.log(
  `${manifest.name}: ${String(documented)}/${String(entries.length)} documented (${(coverage * 100).toFixed(1)}%)`,
);
if (coverage < minimumCoverage) {
  for (const [name, symbol] of entries) {
    if (!symbol.documented) console.log(`  - ${name} (${symbol.location})`);
  }
  process.exitCode = 1;
}

/** The source behind a `types` path: `./dist/x.d.ts` is `./src/x.ts` or `./src/x.tsx`. */
function sourceEntrypoint(types) {
  const path = resolve(root, directory, types);
  if (!types.startsWith("./dist/")) return path;
  const stem = resolve(
    root,
    directory,
    types.replace(/^\.\/dist\//u, "./src/").replace(/\.d\.ts$/u, ""),
  );
  return existsSync(`${stem}.ts`) ? `${stem}.ts` : `${stem}.tsx`;
}
