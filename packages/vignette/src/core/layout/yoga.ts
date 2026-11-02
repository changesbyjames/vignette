import Yoga from "yoga-layout";

import type { LayoutEngine } from "./layout-engine.js";
import { createYogaLayoutEngine } from "./yoga-runtime.js";

/**
 * Default layout engine, backed by yoga-layout's build that embeds its wasm and compiles it at
 * import. Works wherever runtime wasm compilation is allowed (Node, Bun, Deno, browsers). The
 * composer imports this module lazily, only when no `layout` is supplied, so hosts that forbid
 * runtime compilation (Cloudflare Workers) never evaluate it; they use `loadYoga(module)`.
 */
export const yogaLayoutEngine: LayoutEngine = createYogaLayoutEngine(Yoga);
