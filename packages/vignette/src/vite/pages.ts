import { fileURLToPath } from "node:url";

/** Where `vignette dev`, the Vite plugin and `vignette build`'s server put the frame page. */
export const FRAMES_HTML_PATH = "/vignette/frames.html";
/** The frame bundle `frames.html` loads (`./frames.js` relative to the page). */
export const FRAMES_JS_PATH = "/vignette/frames.js";
/** The preview page's script. */
export const PREVIEW_JS_PATH = "/vignette/preview.js";
/** Where the files of the show's `assets/` directory are served, by name. */
export const ASSETS_PATH = "/vignette/assets/";

/** `src/react/preview-page.tsx` as built, by path: it is no export of the package. */
const PREVIEW_PAGE = fileURLToPath(new URL("../../dist/react/preview-page.js", import.meta.url));

/**
 * The browser preview page: its `script` renders the stream filling the window. `?scene=<id>`
 * pins a scene; otherwise it follows the show's active scene.
 */
export function previewHtml(script = PREVIEW_JS_PATH, background = "#000"): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vignette preview</title>
    <style>
      html, body { margin: 0; height: 100%; background: ${background}; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="preview"></div>
    <script type="module" src="${script}"></script>
  </body>
</html>
`;
}

/** The preview page's module: the shared preview page following the stream at `stream`. */
export function previewEntry(stream: string): string {
  return `import { mountPreview } from ${JSON.stringify(PREVIEW_PAGE)};
mountPreview(${JSON.stringify(stream)});
`;
}
