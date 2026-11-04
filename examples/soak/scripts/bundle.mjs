// Bundle the frames and assets the show uses into public/vignette, as the kitchen sink does.
import { bundle } from "vignette/bundle";

const result = await bundle("src/show.tsx", { out: "public/vignette" });
console.log(
  `Bundled ${String(result.frames.length)} frame modules and ${String(result.manifest.entries.length)} assets into public/vignette.`,
);
