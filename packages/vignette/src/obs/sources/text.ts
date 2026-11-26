import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Size } from "../../core/geometry.js";
import {
  cssText,
  fontFaceCss,
  textCss,
  textFontFamily,
  type Text,
  type TextProps,
} from "../../core/sources/text.js";
import type { ObsPluginContext, ObsSourcePlugin } from "../plugin.js";
import { localPageInput } from "./browser.js";

/** The DOM event that tells a text page to re-read its file; obs-browser's `emit_event` dispatches it. */
const REREAD_EVENT = "vignette-text";

/**
 * `<Text>` as a `browser_source` of a local HTML page this plugin writes, with the `font` asset
 * embedded, so OBS needs neither the font installed nor a server. Its path is the same on every
 * run and the file is never deleted: OBS saves the path in its scene collection and asks for a
 * missing file when it starts.
 *
 * The file is the only state. A change rewrites it, and the open page re-reads it and shows what
 * it holds, so the page never reloads: a navigation would show an empty frame, most visibly when
 * the change lands with a cut to the text's scene. The page re-reads on load, on every resize, and
 * when told to through obs-browser's `emit_event`, which carries no state: an event OBS drops, or
 * one that arrives while the page loads, costs nothing the next re-read does not recover.
 *
 * A change of size sends no event. OBS resizes the input after `update` returns, and that resize
 * makes the page re-read, so the page changes only once its viewport has its new size. An event
 * before the resize would repaint the page at its old size while OBS resizes it. A change that
 * cannot be announced reloads the page, now or when OBS reconnects.
 */
export const textObs: ObsSourcePlugin<typeof Text> = {
  kind: "text",
  async create(source, context) {
    const file = await context.sourceFile(source.id, ".html");
    // Every text page hears every event; the name picks out this page's. It is unique per show
    // and source and the same on every run, so a page OBS kept from an earlier run still hears.
    const name = basename(file, extname(file));
    let current = source;
    await writePage(file, pageHtml(await renderPage(source.props, context), name));
    return {
      get input() {
        return localPageInput(file, current.size);
      },
      async update(next) {
        const resized = !sameViewport(current.size, next.size);
        current = next;
        await writePage(file, pageHtml(await renderPage(next.props, context), name));
        if (resized) return;
        await context
          .request(next.id, "CallVendorRequest", {
            vendorName: "obs-browser",
            requestType: "emit_event",
            requestData: { event_name: REREAD_EVENT, event_data: { page: name } },
          })
          .catch(() =>
            // Disconnected, this rejects too; the target reloads text pages once OBS reconnects.
            context.request(next.id, "PressInputPropertiesButton", {
              propertyName: "refreshnocache",
            }),
          )
          .catch(() => undefined);
      },
    };
  },
};

/** Whether two sizes are the same `browser_source` viewport, which is in whole pixels. */
function sameViewport(a: Size, b: Size): boolean {
  return (
    Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height)
  );
}

/** How often, and how many times, a refused replacement of the page file is tried again. */
const REPLACE_RETRY_MS = 20;
const REPLACE_ATTEMPTS = 100;

/**
 * Replaces the page file in one step, so a page loading or re-reading it never finds half of it.
 * The file is never written in place: OBS showing a file cut short shows a page without its
 * script, which stays as it is. Windows refuses to replace a file while OBS reads it, which takes
 * OBS milliseconds, so a refused replacement is tried again before it fails the source.
 */
async function writePage(file: string, html: string): Promise<void> {
  const draft = `${file}.tmp`;
  await writeFile(draft, html);
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(draft, file);
      return;
    } catch (cause) {
      if (attempt === REPLACE_ATTEMPTS) throw cause;
      await delay(REPLACE_RETRY_MS);
    }
  }
}

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
 * The page, and a script that keeps it showing its file: on load, on every resize and on each
 * event addressed to `name`, it fetches the file and copies over the font face, the box and text
 * CSS, and the text, wherever they differ. Reads may overlap; one that started before the read
 * the page already shows is dropped.
 */
function pageHtml(page: TextPage, name: string): string {
  // The script must not contain "<", which the embedding below escapes.
  const script = `
const name = ${JSON.stringify(name)};
let reads = 0;
let shown = 0;
function copy(file, id, attribute) {
  const from = file.getElementById(id);
  const to = document.getElementById(id);
  if (attribute === undefined) {
    if (to.textContent !== from.textContent) to.textContent = from.textContent;
  } else if (to.getAttribute(attribute) !== from.getAttribute(attribute)) {
    to.setAttribute(attribute, from.getAttribute(attribute));
  }
}
async function reread() {
  reads += 1;
  const read = reads;
  try {
    const response = await fetch(location.href, { cache: "no-store" });
    const file = new DOMParser().parseFromString(await response.text(), "text/html");
    if (shown > read) return;
    shown = read;
    copy(file, "face");
    copy(file, "box", "style");
    copy(file, "text", "style");
    copy(file, "text");
  } catch {}
}
window.addEventListener(${JSON.stringify(REREAD_EVENT)}, (event) => {
  if (event.detail && event.detail.page === name) reread();
});
window.addEventListener("resize", reread);
reread();`;
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
