import {
  cssText,
  fontFaceCss,
  textCss,
  textFontFamily,
  type Text,
  type TextProps,
} from "../../core/sources/text.js";
import type { DomPluginContext, DomSourcePlugin } from "../plugin.js";

/** `<Text>` as a box of styled text, with its `font` asset as an `@font-face`. */
export const textDom: DomSourcePlugin<typeof Text> = {
  kind: "text",
  async create(source, context) {
    const { document } = context;
    // The stage positions `element`; the box inside it carries the text's CSS.
    const element = document.createElement("div");
    const face = document.createElement("style");
    const box = document.createElement("div");
    const text = document.createElement("p");
    box.append(text);
    element.append(face, box);
    const render = async (props: TextProps) => {
      const font = await fontFace(props, context);
      face.textContent = font?.css ?? "";
      const css = textCss(props, font?.family);
      box.style.cssText = cssText(css.box);
      text.style.cssText = cssText(css.text);
      text.textContent = props.text;
    };
    await render(source.props);
    return {
      element,
      update: (next) => render(next.props),
      dispose() {
        element.remove();
      },
    };
  },
};

/** A loaded font asset: its `@font-face` family and rule. */
interface LoadedFontFace {
  readonly family: string;
  readonly css: string;
}

/** The `@font-face` family and rule for the text's `font` asset, if it names one. */
async function fontFace(
  props: TextProps,
  { assets }: DomPluginContext,
): Promise<LoadedFontFace | undefined> {
  if (props.font === undefined) return undefined;
  const family = textFontFamily(props.font);
  return { family, css: fontFaceCss(family, await assets.resolve(props.font)) };
}
