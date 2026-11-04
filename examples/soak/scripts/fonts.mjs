// Fonts come from @fontsource packages, but a show's assets are the files under src/assets, so
// copy the ones the show uses there. Run before `vignette bundle` and `vignette dev`.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fonts = ["@fontsource/nunito/files/nunito-latin-700-normal.woff2"];

await mkdir("src/assets/fonts", { recursive: true });
for (const font of fonts) {
  await copyFile(require.resolve(font), `src/assets/fonts/${font.split("/").at(-1)}`);
}
