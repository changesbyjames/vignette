import { z } from "zod";
import type { ObsSourceCodec } from "@strangecyan/vignette-target-obs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Any value with the fields of an `ObsSourceCodec`; `compile` is called with the codec as `this`. */
const ExtensionCodecSchema = z.custom<ObsSourceCodec>(
  (value) =>
    z
      .object({
        kind: z.templateLiteral(["source:", z.string()]),
        inputKinds: z.array(z.string()),
        compile: z.instanceof(Function),
      })
      .safeParse(value).success,
);
type ExtensionCodec = z.output<typeof ExtensionCodecSchema>;

const ExportedListSchema = z.array(z.unknown());
type ExportedList = z.output<typeof ExportedListSchema>;

/** Every codec a module exports, directly or inside an exported array; other exports are ignored. */
const ExtensionModuleSchema = z.looseObject({}).transform((namespace) =>
  Object.values(namespace)
    .flatMap((value): ExportedList => {
      const list = ExportedListSchema.safeParse(value);
      return list.success ? list.data : [value];
    })
    .flatMap((value): readonly ExtensionCodec[] => {
      const codec = ExtensionCodecSchema.safeParse(value);
      return codec.success ? [codec.data] : [];
    }),
);
type ExtensionModule = z.output<typeof ExtensionModuleSchema>;

/** URL schemes are at least two characters, so Windows drive letters are treated as paths. */
const URL_SPECIFIER = /^[A-Za-z][A-Za-z\d+.-]+:/u;

/**
 * Loads the OBS source codecs exported by each `--extension` module. Every export (including a
 * default export) that is an `ObsSourceCodec`, or an array of them, is registered; a module with
 * none is an error. Relative paths and bare package specifiers resolve from `cwd`, falling back to
 * the CLI's own resolution for bare specifiers.
 */
export async function loadObsExtensions(
  specifiers: readonly string[],
  cwd: string,
): Promise<readonly ObsSourceCodec[]> {
  const codecs = new Set<ExtensionCodec>();
  for (const specifier of specifiers) {
    const exported = await importCodecs(specifier, cwd);
    if (exported.length === 0) {
      throw new Error(
        `Extension '${specifier}' exports no OBS source codecs (objects with kind, inputKinds, and compile).`,
      );
    }
    for (const codec of exported) codecs.add(codec);
  }
  return [...codecs];
}

async function importCodecs(specifier: string, cwd: string): Promise<ExtensionModule> {
  try {
    return ExtensionModuleSchema.parse(
      await import(/* @vite-ignore */ resolveExtensionSpecifier(specifier, cwd)),
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not load extension '${specifier}': ${reason}`, { cause });
  }
}

/** URLs pass through; paths resolve against `cwd`; bare specifiers prefer the project's install. */
function resolveExtensionSpecifier(specifier: string, cwd: string): string {
  if (URL_SPECIFIER.test(specifier)) return specifier;
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return pathToFileURL(resolve(cwd, specifier)).href;
  }
  try {
    return pathToFileURL(createRequire(resolve(cwd, "package.json")).resolve(specifier)).href;
  } catch {
    return specifier;
  }
}
