import type { CompiledSnapshot } from "@strangecyan/vignette-core";
import { createComposerRoot } from "@strangecyan/vignette";

import { composition } from "./show.js";

const root = createComposerRoot(composition, { onError: console.error });

let publishSnapshot: (snapshot: CompiledSnapshot) => void = () => undefined;
const nextSnapshot = new Promise<CompiledSnapshot>((resolve) => {
  publishSnapshot = resolve;
});
const unsubscribe = root.subscribe(publishSnapshot);

await root.render();

console.log(JSON.stringify(await nextSnapshot, null, 2));
unsubscribe();
await root.dispose();
