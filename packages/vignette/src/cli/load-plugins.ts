import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import type { ObsSourcePlugin } from "../obs/plugin.js";

/** Any value with the members of an `ObsSourcePlugin`: a `kind` and a `create` function. */
const PluginExportSchema = z.custom<ObsSourcePlugin>(
  (value) =>
    z.object({ kind: z.string(), create: z.instanceof(Function) }).safeParse(value).success,
);
type PluginExport = z.output<typeof PluginExportSchema>;

const ExportedListSchema = z.array(z.unknown());
type ExportedList = z.output<typeof ExportedListSchema>;

/** Every plugin a module exports, directly or inside an exported array; other exports are ignored. */
const PluginModuleSchema = z.looseObject({}).transform((namespace) =>
  Object.values(namespace)
    .flatMap((value): ExportedList => {
      const list = ExportedListSchema.safeParse(value);
      return list.success ? list.data : [value];
    })
    .flatMap((value): readonly PluginExport[] => {
      const plugin = PluginExportSchema.safeParse(value);
      return plugin.success ? [plugin.data] : [];
    }),
);
type PluginModule = z.output<typeof PluginModuleSchema>;

/** URL schemes are at least two characters, so Windows drive letters are treated as paths. */
const URL_SPECIFIER = /^[A-Za-z][A-Za-z\d+.-]+:/u;

/**
 * Loads the OBS source plugins exported by each `--source` module, in order. Every export
 * (including a default export) that is an `ObsSourcePlugin`, or an array of them, is collected; a
 * module with none is an error. Relative paths and bare package specifiers resolve from `cwd`.
 */
export async function loadPlugins(
  specifiers: string[],
  cwd: string,
): Promise<readonly ObsSourcePlugin[]> {
  const plugins = new Set<PluginExport>();
  for (const specifier of specifiers) {
    const exported = await importPlugins(specifier, cwd);
    if (exported.length === 0) {
      throw new Error(
        `Source module '${specifier}' exports no OBS source plugins (objects with kind and create).`,
      );
    }
    for (const plugin of exported) plugins.add(plugin);
  }
  return [...plugins];
}

async function importPlugins(specifier: string, cwd: string): Promise<PluginModule> {
  try {
    return PluginModuleSchema.parse(
      await import(/* @vite-ignore */ resolveSpecifier(specifier, cwd)),
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not load source module '${specifier}': ${reason}`, { cause });
  }
}

/** URLs pass through; paths resolve against `cwd`; bare specifiers prefer the project's install. */
function resolveSpecifier(specifier: string, cwd: string): string {
  if (URL_SPECIFIER.test(specifier)) return specifier;
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return pathToFileURL(resolve(cwd, specifier)).href;
  }
  try {
    return pathToFileURL(createRequire(resolve(cwd, "package.json")).resolve(specifier)).href;
  } catch {
    // Not installed in the project (or exported for `import` only): let Node resolve it.
    return specifier;
  }
}
