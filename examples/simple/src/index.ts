import { compose } from "@strangecyan/vignette";

import show from "./show.js";

// One-shot: render the show, wait for it to settle, dispose, and print the snapshot.
const snapshot = await compose(show, { onError: console.error }).once();

console.log(JSON.stringify(snapshot, null, 2));
