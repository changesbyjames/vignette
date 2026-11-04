import type { CSSProperties, ReactNode } from "react";

import {
  fontFaceCss,
  textCss,
  textFontFamily,
  type CssDeclaration,
  type Text,
} from "../../core/sources/text.js";
import { useAsset } from "../assets.js";
import type { ReactSourcePlugin, ReactSourceViewProps } from "../plugin.js";

/** `<Text>` as a box of styled text; suspends until its `font` asset is downloaded. */
export const TextView: ReactSourcePlugin<typeof Text> = {
  kind: "text",
  View: TextSource,
};

function TextSource({ source }: ReactSourceViewProps<typeof Text>): ReactNode {
  const { font } = source.props;
  const family = font === undefined ? undefined : textFontFamily(font);
  const css = textCss(source.props, family);
  return (
    <div style={reactStyle(css.box)}>
      {font !== undefined && family !== undefined && <FontFace font={font} family={family} />}
      <p style={reactStyle(css.text)}>{source.props.text}</p>
    </div>
  );
}

/** Props of {@link FontFace}. */
interface FontFaceProps {
  readonly font: string;
  readonly family: string;
}

/** The `@font-face` rule for a downloaded font asset. */
function FontFace({ font, family }: FontFaceProps): ReactNode {
  return <style>{fontFaceCss(family, useAsset(font))}</style>;
}

/** CSS declarations as a React style object: `font-size` as `fontSize`, `-webkit-x` as `WebkitX`. */
function reactStyle(declarations: readonly CssDeclaration[]): CSSProperties {
  const style: Record<string, string> = {};
  for (const [property, value] of declarations) {
    const name = property
      .replace(/^-webkit-/u, "Webkit-")
      .replaceAll(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
    style[name] = value;
  }
  return style;
}
