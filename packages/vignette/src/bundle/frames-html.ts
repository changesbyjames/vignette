/** Options for {@link framesHtml}. */
export interface FramesHtmlOptions {
  /** URL of the frame bundle, usually relative to the page (`./frames.js`). */
  readonly script: string;
}

/**
 * The static page OBS opens for every frame. It knows nothing about where it is hosted; the frame
 * bundle reads `frame`, `source` and `stream` from the page's query string.
 */
export function framesHtml({ script }: FramesHtmlOptions): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; background: transparent; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="frame"></div>
    <script type="module" src="${escapeAttribute(script)}"></script>
  </body>
</html>
`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
