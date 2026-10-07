import { compile } from "@strangecyan/vignette";

import { composition } from "./show.js";

// One-shot: render the composition, wait for it to settle, print the snapshot, and dispose.
const snapshot = await compile(composition, { onError: console.error });

console.log(JSON.stringify(snapshot, null, 2));
