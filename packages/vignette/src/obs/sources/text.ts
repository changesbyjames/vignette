import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import {
  cssText,
  fontFaceCss,
  textCss,
  textFontFamily,
  type Text,
  type TextProps,
} from "../../core/sources/text.js";
import { ObsDisconnectedError } from "../errors.js";
import type { ObsJsonObject } from "../operations.js";
import type { ObsPluginContext, ObsSourcePlugin } from "../plugin.js";
import { localPageInput } from "./browser.js";

/** The DOM event a text page listens for; obs-browser's `emit_event` dispatches it. */
const UPDATE_EVENT = "vignette-text";

/**
 * `<Text>` as a `browser_source` of a local HTML page this plugin writes, with the `font` asset
 * embedded, so OBS needs neither the font installed nor a server. A change is pushed into the
 * open page through obs-browser's `emit_event`, so the page never reloads: a navigation would show
 * an empty frame, most visibly when the change lands with a cut to the text's scene. Its path is
 * the same on every run and the file is never deleted: OBS saves the path in its scene collection
 * and asks for a missing file when it starts.
 *
 * Every state the page can show carries a sequence number that only grows, and the page ignores
 * an older one than it shows, so a state may arrive any number of times and in any order. `update`
 * rewrites the file with the new state, then pushes it. The push runs before OBS resizes the
 * input, and obs-browser may drop an event that lands mid-resize, so the page also re-reads its
 * own file on load and on every resize, which recovers the state the push carried.
 *
 * A push that fails reloads the page; a reload that fails too is ignored, since the file already
 * holds the state for the next load or resize. While OBS is disconnected nothing is sent, because
 * the target reloads text pages when OBS reconnects.
 */
export const textObs: ObsSourcePlugin<typeof Text> = {
  kind: "text",
  async create(source, context) {
    const file = await context.sourceFile(source.id, ".html");
    // Every text page hears every event; the token picks out this page's. The file name is
    // unique per show and source and the same on every run, so a page OBS kept from an earlier
    // run, or from an earlier handle, still hears this one.
    const token = basename(file, extname(file));
    let current = source;
    let page = await renderPage(source.props, context);
    let seq = nextSeq(0);
    await writeFile(file, pageHtml(page, token, seq));
    return {
      get input() {
        return localPageInput(file, current.size);
      },
      async update(next) {
        const previous = page;
        current = next;
        page = await renderPage(next.props, context);
        seq = nextSeq(seq);
        await writeFile(file, pageHtml(page, token, seq));
        try {
          await context.request(next.id, "CallVendorRequest", {
            vendorName: "obs-browser",
            requestType: "emit_event",
            requestData: {
              event_name: UPDATE_EVENT,
              event_data: pageUpdate(previous, page, token, seq),
            },
          });
        } catch (cause) {
          if (cause instanceof ObsDisconnectedError) return;
          await context
            .request(next.id, "PressInputPropertiesButton", { propertyName: "refreshnocache" })
            .catch(() => undefined);
        }
      },
    };
  },
};

/** A sequence number above `previous`; time-based, so it keeps growing across runs. */
function nextSeq(previous: number): number {
  return Math.max(previous + 1, Date.now());
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

/** A state the page can show; the font face goes in the page's own style element. */
function pageState(page: TextPage, token: string, seq: number): ObsJsonObject {
  return { token, seq, box: page.box, style: page.style, text: page.text };
}

/**
 * The event payload: the state, leaving out an unchanged (large) font. A text page applies `face`
 * only when present.
 */
function pageUpdate(previous: TextPage, next: TextPage, token: string, seq: number): ObsJsonObject {
  const state = pageState(next, token, seq);
  return next.face === previous.face ? state : { ...state, face: next.face };
}

/**
 * The page showing state `seq`, which it also holds as JSON for re-reads, and a script applying
 * later states addressed to `token`. On load and on every resize, the page fetches its own file
 * and applies the state there if it is not older than the one it shows.
 */
function pageHtml(page: TextPage, token: string, seq: number): string {
  // The script must not contain "<", which the embedding below escapes.
  const script = `
const token = ${JSON.stringify(token)};
const face = document.getElementById("face");
const box = document.getElementById("box");
const text = document.getElementById("text");
let applied = JSON.parse(document.getElementById("state").textContent).seq;
function apply(state) {
  if (!state || state.token !== token || typeof state.seq !== "number" || applied > state.seq) return;
  applied = state.seq;
  if (typeof state.face === "string" && face.textContent !== state.face) face.textContent = state.face;
  box.style.cssText = state.box;
  text.style.cssText = state.style;
  text.textContent = state.text;
}
window.addEventListener(${JSON.stringify(UPDATE_EVENT)}, (event) => apply(event.detail));
async function reread() {
  try {
    const response = await fetch(location.href, { cache: "no-store" });
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const state = JSON.parse(page.getElementById("state").textContent);
    apply({ ...state, face: page.getElementById("face").textContent });
  } catch {
    // A file being rewritten, or a page that may not fetch itself: the next push still arrives.
  }
}
window.addEventListener("resize", () => void reread());
void reread();`;
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    "<style>html, body { margin: 0; height: 100%; background: transparent; }</style>",
    `<style id="face">${escapeStyle(page.face)}</style>`,
    "</head><body>",
    `<div id="box" style="${escapeAttribute(page.box)}">`,
    `<p id="text" style="${escapeAttribute(page.style)}">${escapeText(page.text)}</p>`,
    // After the face: a re-read of a half-written file finds no state and changes nothing.
    `</div><script type="application/json" id="state">${escapeScript(JSON.stringify(pageState(page, token, seq)))}</script>`,
    `<script>${escapeScript(script)}</script></body></html>`,
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

/** Keeps a script element's content from closing it; valid in JSON and in JavaScript strings. */
function escapeScript(value: string): string {
  return value.replaceAll("<", "\\u003c");
}

/** Keeps a style element's content from closing it. */
function escapeStyle(value: string): string {
  return value.replaceAll("<", "\\3c ");
}
