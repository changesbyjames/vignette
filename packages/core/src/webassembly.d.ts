// Core compiles against ES and Node types only, which do not declare the WebAssembly global. This
// declares the subset the Yoga Wasm entry and its tests use; it is not emitted, so consumers resolve
// `WebAssembly` from their own platform types (DOM, webworker, or @cloudflare/workers-types).
declare namespace WebAssembly {
  // oxlint-disable-next-line typescript/no-empty-object-type -- Opaque handle owned by the host engine.
  interface Module {}
  // oxlint-disable-next-line typescript/no-empty-object-type -- Opaque handle owned by the host engine.
  interface Instance {}
  type ImportValue = ((...args: never[]) => void) | number | bigint;
  type Imports = Readonly<Record<string, Readonly<Record<string, ImportValue>>>>;

  function compile(bytes: Uint8Array): Promise<Module>;
  function instantiate(module: Module, imports?: Imports): Promise<Instance>;
}

// The vendored Yoga binary, imported by the `workerd` build of `layout-yoga` as a precompiled module.
declare module "*/yoga.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
