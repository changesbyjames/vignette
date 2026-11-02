import { z } from "zod";

import { defineSource } from "../define-source.js";

/**
 * How a `<Text>` is set, named after the CSS properties every target applies. Layout gives the
 * text a box; these decide how the text sits in it. Sizes are pixels.
 */
const TextStyleSchema = z.object({
  /** A CSS font family list, after the `font` asset when there is one: its fallback. Default `sans-serif`. */
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().positive().default(48),
  fontWeight: z.union([z.number().int().min(1).max(1000), z.enum(["normal", "bold"])]).optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  /** `#rrggbb` or `#rrggbbaa`. Default white. */
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu, "Use #rrggbb or #rrggbbaa.")
    .default("#ffffff"),
  /** A multiple of `fontSize`. */
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.number().optional(),
  textAlign: z.enum(["start", "end", "left", "right", "center", "justify"]).optional(),
  /** `balance` evens out line lengths; `pretty` avoids a lone last word. Default `wrap`. */
  textWrap: z.enum(["wrap", "nowrap", "balance", "pretty"]).optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  /** A CSS `text-shadow` value, e.g. `0 2px 8px #000000aa`. */
  textShadow: z.string().min(1).optional(),
  /** Where the lines sit in the box. Default `top`. */
  verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
  /** Cuts the text after this many lines with an ellipsis. */
  maxLines: z.number().int().positive().optional(),
});
/** How a `<Text>` is set, after its schema. */
export type TextStyle = z.output<typeof TextStyleSchema>;

/**
 * Text that fills its layer. `text` keeps its line breaks. `font` names a font file in the
 * project's assets (`.woff2`, `.woff`, `.ttf` or `.otf`), downloaded like any asset, so the
 * target does not need it installed. Every target renders it as HTML with {@link textCss}.
 *
 * ```tsx
 * <Text text="Up next" font="fonts/Inter.woff2" style={{ textAlign: "center", textWrap: "balance" }} />
 * ```
 */
export const Text = defineSource({
  kind: "text",
  props: z.object({
    text: z.string(),
    font: z.string().min(1).optional(),
    style: TextStyleSchema.prefault({}),
  }),
  size: (_props, { canvas, layer }) => layer ?? canvas,
  assets: ["font"],
});

/** A text source's props, after its schema. */
export type TextProps = z.output<typeof Text.definition.props>;

/** One CSS declaration: a property, in CSS spelling, and its value. */
export type CssDeclaration = readonly [property: string, value: string];

/** The two elements a text renders as: a box filling the source, and the text inside it. */
export interface TextCss {
  readonly box: readonly CssDeclaration[];
  readonly text: readonly CssDeclaration[];
}

const JUSTIFY = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

/**
 * The CSS every target sets a text with. `family` is the `@font-face` family of the `font`
 * asset, from {@link textFontFamily}, when the target has loaded one.
 */
export function textCss(props: TextProps, family?: string): TextCss {
  const { style } = props;
  // The `font` asset first; `fontFamily`, or a generic family, if it cannot load.
  const families = [
    family === undefined ? undefined : cssString(family),
    style.fontFamily ?? "sans-serif",
  ];
  const text: CssDeclaration[] = [
    ["width", "100%"],
    ["margin", "0"],
    ["font-family", families.filter((entry) => entry !== undefined).join(", ")],
    ["font-size", `${String(style.fontSize)}px`],
    ["color", style.color],
    // Before `text-wrap`: the `white-space` shorthand resets it.
    ["white-space", "pre-line"],
    ["overflow-wrap", "break-word"],
  ];
  text.push(...optionalDeclarations(style), ...lineClamp(style.maxLines));
  return {
    box: [
      ["box-sizing", "border-box"],
      ["width", "100%"],
      ["height", "100%"],
      ["overflow", "hidden"],
      ["display", "flex"],
      ["flex-direction", "column"],
      ["justify-content", JUSTIFY[style.verticalAlign ?? "top"]],
    ],
    text,
  };
}

/** The CSS for each optional style field that is set, in CSS spelling and units. */
function optionalDeclarations(style: TextStyle): CssDeclaration[] {
  const fields: readonly (readonly [string, string | undefined])[] = [
    ["font-weight", plain(style.fontWeight)],
    ["font-style", style.fontStyle],
    ["line-height", plain(style.lineHeight)],
    ["letter-spacing", pixels(style.letterSpacing)],
    ["text-align", style.textAlign],
    ["text-wrap", style.textWrap],
    ["text-transform", style.textTransform],
    ["text-shadow", style.textShadow],
  ];
  return fields.flatMap(([property, value]) => (value === undefined ? [] : [[property, value]]));
}

function plain(value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function pixels(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${String(value)}px`;
}

function lineClamp(maxLines: number | undefined): CssDeclaration[] {
  if (maxLines === undefined) return [];
  return [
    ["display", "-webkit-box"],
    ["-webkit-box-orient", "vertical"],
    ["-webkit-line-clamp", String(maxLines)],
    ["overflow", "hidden"],
  ];
}

/** The `@font-face` family a target registers the `font` asset under. */
export function textFontFamily(font: string): string {
  return `vignette-font-${font.replaceAll(/[^\w.-]/gu, "-")}`;
}

/** An `@font-face` rule for `family` loading `url`. */
export function fontFaceCss(family: string, url: string): string {
  return `@font-face { font-family: ${cssString(family)}; src: url(${cssString(url)}); font-display: block; }`;
}

/** Declarations as a `style` attribute or `cssText` value. */
export function cssText(declarations: readonly CssDeclaration[]): string {
  return declarations.map(([property, value]) => `${property}: ${value};`).join(" ");
}

/** A CSS string literal. */
function cssString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
