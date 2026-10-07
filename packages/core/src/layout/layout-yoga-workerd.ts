// Selected for `@strangecyan/vignette-core/layout-yoga` by the `workerd` export condition. Workers
// cannot compile Wasm from bytes at runtime, so this imports the vendored binary as a precompiled
// `WebAssembly.Module` (Wrangler and @cloudflare/vite-plugin support `.wasm` imports natively).
import yogaWasm from "../../vendor/yoga/yoga.wasm";
import type { LayoutEngine } from "./layout-engine.js";
import { createYogaWasmLayoutEngine } from "./layout-yoga-wasm.js";

export { createYogaLayoutEngine } from "./yoga-runtime.js";

/** Layout engine backed by the same yoga-layout build, instantiated from a precompiled module. */
export const yogaLayoutEngine: LayoutEngine = await createYogaWasmLayoutEngine(yogaWasm);
