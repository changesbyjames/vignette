import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import {
  cssText,
  fontFaceCss,
  textCss,
  textFontFamily,
  type Text,
  type TextProps,
} from "../../core/sources/text.js";
import type { ObsJsonObject } from "../operations.js";
import type { ObsPluginContext, ObsSourcePlugin } from "../plugin.js";
import { localPageInput } from "./browser.js";

/** The DOM event a text page listens for; obs-browser's `emit_event` dispatches it. */
const UPDATE_EVENT = "vignette-text";

/**
 * `<Text>` as a `browser_source` of a local HTML page this plugin writes, with the `font` asset
 * embedded, so OBS needs neither the font installed nor a server. A change is pushed into the
 * open page through obs-browser's `emit_event`, so the page never reloads: a navigation would show
 * an empty frame, most visibly when the change lands with a cut to the text's scene. The page file
 * is rewritten too, for whenever OBS loads it afresh; if OBS cannot be reached, the change goes to
 * a new file instead, which OBS navigates to once it converges.
 */
export const textObs: ObsSourcePlugin<typeof Text> = {
  kind: "text",
  async create(source, context) {
    const directory = await mkdtemp(join(tmpdir(), "vignette-text-"));
    // Every text page hears every event; the token picks out this page's.
    const token = randomUUID();
    let current = source;
    let page = await renderPage(source.props, context);
    let generation = 0;
    let file = join(directory, "text-0.html");
    await writeFile(file, pageHtml(page, token));
    return {
      get input() {
        return localPageInput(file, current.size);
      },
      async update(next) {
        const previous = page;
        current = next;
        page = await renderPage(next.props, context);
        await writeFile(file, pageHtml(page, token));
        const pushed = await context
          .request(next.id, "CallVendorRequest", {
            vendorName: "obs-browser",
            requestType: "emit_event",
            requestData: {
              event_name: UPDATE_EVENT,
              event_data: pageUpdate(previous, page, token),
            },
          })
          .then(
            () => true,
            () => false,
          );
        if (pushed) return;
        const stale = file;
        generation += 1;
        file = join(directory, `text-${String(generation)}.html`);
        await writeFile(file, pageHtml(page, token));
        await rm(stale, { force: true });
      },
      async dispose() {
        await rm(directory, { recursive: true, force: true });
      },
    };
  },
};

/** Everything a text page shows: the `@font-face` rule, the box and text CSS, and the text. */
interface TextPage {
  readonly face: string;
  readonly box: string;
  readonly style: string;
  readonly text: string;
}

async function renderPage(props: TextProps, { assets }: ObsPluginContext): Promise<TextPage> {
  const family = props.font === undefined ? undefined : textFontFamily(props.font);
  const face =
    props.font === undefined || family === undefined
      ? ""
      : fontFaceCss(family, await fontDataUrl(await assets.resolve(props.font)));
  const css = textCss(props, family);
  return { face, box: cssText(css.box), style: cssText(css.text), text: props.text };
}

/**
 * The event payload: the page as it should now be, leaving out an unchanged (large) font. A text
 * page applies `face` only when present.
 */
function pageUpdate(previous: TextPage, next: TextPage, token: string): ObsJsonObject {
  const update = { token, box: next.box, style: next.style, text: next.text };
  return next.face === previous.face ? update : { ...update, face: next.face };
}

/** The page, and a script applying later updates addressed to `token`. */
function pageHtml(page: TextPage, token: string): string {
  const script = `
const token = ${JSON.stringify(token)};
window.addEventListener(${JSON.stringify(UPDATE_EVENT)}, (event) => {
  const update = event.detail;
  if (!update || update.token !== token) return;
  if (typeof update.face === "string") document.getElementById("face").textContent = update.face;
  document.getElementById("box").style.cssText = update.box;
  const text = document.getElementById("text");
  text.style.cssText = update.style;
  text.textContent = update.text;
});`;
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    "<style>html, body { margin: 0; height: 100%; background: transparent; }</style>",
    `<style id="face">${escapeStyle(page.face)}</style>`,
    "</head><body>",
    `<div id="box" style="${escapeAttribute(page.box)}">`,
    `<p id="text" style="${escapeAttribute(page.style)}">${escapeText(page.text)}</p>`,
    `</div><script>${script.replaceAll("<", "\\u003c")}</script></body></html>`,
  ].join("");
}

const FONT_TYPES = new Map([
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
]);

/** The font file as a `data:` URL; a page in a file may not load other files. */
async function fontDataUrl(file: string): Promise<string> {
  const type = FONT_TYPES.get(extname(file).toLowerCase()) ?? "application/octet-stream";
  return `data:${type};base64,${(await readFile(file)).toString("base64")}`;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

/** Keeps a style element's content from closing it. */
function escapeStyle(value: string): string {
  return value.replaceAll("<", "\\3c ");
}
