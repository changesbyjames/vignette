import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectories = [
  "packages/core",
  "packages/target-dom",
  "packages/target-obs",
  "packages/react",
  "packages/frame",
  "packages/vite",
  "packages/moq",
  "packages/testkit",
  "packages/preview",
];
const minimumCoverage = 0.8;
let failed = false;

for (const directory of packageDirectories) {
  const manifest = JSON.parse(readFileSync(resolve(root, directory, "package.json"), "utf8"));
  const entrypoints = Object.values(manifest.exports).map(({ types }) =>
    resolve(root, directory, sourceEntrypoint(types)),
  );
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
      if (
        !declarations.some((declaration) =>
          declaration.getSourceFile().fileName.includes(directory),
        )
      ) {
        continue;
      }
      const documentation = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
      const declaration = declarations[0];
      const location = declaration
        ?.getSourceFile()
        .getLineAndCharacterOfPosition(declaration.getStart());
      symbols.set(exported.getName(), {
        documented: documentation.length > 0,
        location:
          declaration === undefined || location === undefined
            ? directory
            : `${declaration.getSourceFile().fileName.slice(root.length + 1)}:${String(location.line + 1)}`,
      });
    }
  }

  const entries = [...symbols.entries()];
  const documented = entries.filter(([, symbol]) => symbol.documented).length;
  const coverage = entries.length === 0 ? 1 : documented / entries.length;
  console.log(
    `${manifest.name}: ${String(documented)}/${String(entries.length)} documented (${(coverage * 100).toFixed(1)}%)`,
  );
  if (coverage >= minimumCoverage) continue;
  failed = true;
  for (const [name, symbol] of entries) {
    if (!symbol.documented) console.log(`  - ${name} (${symbol.location})`);
  }
}

if (failed) process.exitCode = 1;

function sourceEntrypoint(types) {
  if (types.startsWith("./src/")) return types;
  return types.replace(/^\.\/dist\//u, "./src/").replace(/\.d\.ts$/u, ".ts");
}
