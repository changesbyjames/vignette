import Yoga from "yoga-layout";

import type { LayoutEngine } from "./layout-engine.js";
import { createYogaLayoutEngine } from "./yoga-runtime.js";

export { createYogaLayoutEngine } from "./yoga-runtime.js";

/** Default layout engine backed by yoga-layout's embedded WASM distribution. */
export const yogaLayoutEngine: LayoutEngine = createYogaLayoutEngine(Yoga);
