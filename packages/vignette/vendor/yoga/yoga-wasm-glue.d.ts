/** Opaque Emscripten module produced by yoga-layout's glue before `wrapAssembly`. */
export interface YogaAssembly {
  readonly __yogaAssembly: unique symbol;
}

/** Emscripten hooks accepted by the glue; `instantiateWasm` must report the instance via `receive`. */
export interface YogaAssemblyOptions {
  instantiateWasm(
    imports: WebAssembly.Imports,
    receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ): Record<string, never>;
}

declare function loadYogaAssembly(options: YogaAssemblyOptions): Promise<YogaAssembly>;
export default loadYogaAssembly;
