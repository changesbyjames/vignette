/**
 * yoga-layout's WebAssembly binary as a standalone file, for runtimes that require precompiled Wasm
 * (Cloudflare Workers import `.wasm` files as `WebAssembly.Module`). Pass it to
 * `createYogaWasmLayoutEngine` from `@strangecyan/vignette-core/layout-yoga-wasm`.
 */
declare const yogaWasm: WebAssembly.Module;
// oxlint-disable-next-line import/no-default-export -- Bundlers expose Wasm modules as the default export.
export default yogaWasm;
