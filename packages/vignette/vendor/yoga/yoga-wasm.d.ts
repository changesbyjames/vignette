/**
 * yoga-layout's WebAssembly binary as a standalone file, for runtimes that require precompiled Wasm
 * (Cloudflare Workers import `.wasm` files as `WebAssembly.Module`). Pass it to `loadYoga` from
 * `@strangecyan/vignette`.
 */
declare const yogaWasm: WebAssembly.Module;
export default yogaWasm;
