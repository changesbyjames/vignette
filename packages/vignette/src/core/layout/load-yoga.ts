import loadYogaAssembly from "../../../vendor/yoga/yoga-wasm-glue.js";
import wrapAssembly from "../../../vendor/yoga/wrap-assembly.js";
import type { LayoutEngine } from "./layout-engine.js";
import { createYogaLayoutEngine } from "./yoga-runtime.js";

/**
 * Loads a Yoga layout engine by hand, for `compose(show, { layout })`.
 *
 * Without an argument it resolves the default engine (yoga-layout with embedded wasm). Hosts that
 * forbid compiling wasm at runtime, such as Cloudflare Workers, import the precompiled binary and
 * pass it in; layout is identical either way:
 *
 * ```ts
 * import yogaWasm from "@strangecyan/vignette/yoga.wasm";
 * const layout = await loadYoga(yogaWasm);
 * ```
 *
 * Each call with a module instantiates a fresh Yoga heap; create one engine per isolate.
 */
export async function loadYoga(wasm?: WebAssembly.Module): Promise<LayoutEngine> {
  if (wasm === undefined) return (await import("./yoga.js")).yogaLayoutEngine;
  // Emscripten has no rejection path for a custom instantiator, so race its failure explicitly.
  let rejectInstantiation: (cause: Error) => void = () => undefined;
  const instantiationFailure = new Promise<never>((_resolve, reject) => {
    rejectInstantiation = reject;
  });
  const assembly = await Promise.race([
    loadYogaAssembly({
      instantiateWasm(imports, receive) {
        WebAssembly.instantiate(wasm, imports).then(
          (instance) => {
            receive(instance, wasm);
          },
          (cause: unknown) => {
            rejectInstantiation(
              cause instanceof Error ? cause : new Error("Yoga wasm instantiation failed."),
            );
          },
        );
        return {};
      },
    }),
    instantiationFailure,
  ]);
  return createYogaLayoutEngine(wrapAssembly(assembly));
}
