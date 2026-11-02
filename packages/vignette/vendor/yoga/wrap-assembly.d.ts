import type { Yoga } from "yoga-layout/load";

import type { YogaAssembly } from "./yoga-wasm-glue.js";

declare function wrapAssembly(assembly: YogaAssembly): Yoga;
export default wrapAssembly;
