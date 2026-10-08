import loadYogaAssembly from "../../vendor/yoga/yoga-wasm-glue.js";
import wrapAssembly from "../../vendor/yoga/wrap-assembly.js";
import type { LayoutEngine } from "./layout-engine.js";
import { createYogaLayoutEngine } from "./yoga-runtime.js";

/**
 * Creates the Yoga layout engine from a precompiled `WebAssembly.Module` instead of compiling
 * embedded bytes at runtime, for hosts such as Cloudflare Workers that forbid runtime Wasm
 * compilation. It runs the same yoga-layout build as `@strangecyan/vignette-core/layout-yoga`, so
 * layout is identical across hosts:
 *
 * ```ts
 * import yogaWasm from "@strangecyan/vignette-core/yoga.wasm";
 * import { createYogaWasmLayoutEngine } from "@strangecyan/vignette-core/layout-yoga-wasm";
 *
 * const layoutEngine = await createYogaWasmLayoutEngine(yogaWasm);
 * ```
 *
 * The module must be compiled from `@strangecyan/vignette-core/yoga.wasm`. Create one engine per
 * isolate and share it; each call instantiates a fresh Yoga heap.
 */
export async function createYogaWasmLayoutEngine(wasm: WebAssembly.Module): Promise<LayoutEngine> {
  // Emscripten has no rejection path for a custom instantiator, so race its failure explicitly.
  let rejectInstantiation: (cause: unknown) => void = () => undefined;
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
            rejectInstantiation(cause);
          },
        );
        return {};
      },
    }),
    instantiationFailure,
  ]);
  return createYogaLayoutEngine(wrapAssembly(assembly));
}
