import { createElement, type ReactElement } from "react";
import { z } from "zod";

import { defineSource, type SourceIdProp } from "../define-source.js";

/** The `frame` source kind: a frame page identified by its name, with JSON params. */
const FrameSource = defineSource({
  kind: "frame",
  props: z.object({ frame: z.string().min(1), params: z.json().default({}) }),
  size: (_props, { canvas, layer }) => layer ?? canvas,
});

/** Validates a frame's params; satisfied by the schema `frame()` was given. */
export interface FrameParamsParser<Params> {
  parse(input: z.input<z.ZodType<Params>>): Params;
}

/**
 * What `<Frame of>` needs from a frame definition: its name and params schema. Every `frame()`
 * from `@strangecyan/vignette/frame` satisfies it.
 */
export interface FrameReference<Params> {
  readonly name: string;
  readonly params: FrameParamsParser<Params>;
}

/** Props shared by every `<Frame>` placement. */
export interface FrameBaseProps<Params> extends SourceIdProp {
  readonly of: FrameReference<Params>;
}

/** `params` for a frame defined without a params schema. */
export interface OptionalFrameParams<Params> {
  readonly params?: Params;
}

/** `params` for a frame with a params schema. */
export interface RequiredFrameParams<Params> {
  readonly params: Params;
}

/** Props of `<Frame>`: the frame definition and its params, which are omitted when it has none. */
export type FrameProps<Params> = FrameBaseProps<Params> &
  (Record<never, never> extends Params ? OptionalFrameParams<Params> : RequiredFrameParams<Params>);

/**
 * Places a frame, a React DOM component served as a page, as a source. Params are validated
 * against the frame's schema here, in the show, and again in the page. The snapshot carries
 * `{ frame: of.name, params }`, never a URL.
 */
export function Frame<Params>(props: FrameProps<Params>): ReactElement {
  const parsed = props.of.params.parse(props.params ?? {});
  return createElement(FrameSource, {
    id: props.id,
    frame: props.of.name,
    // SAFETY: Frame params must be JSON; the `frame` kind's schema rejects anything else with an INVALID_PROPS diagnostic.
    params: parsed as z.input<typeof FrameSource.definition.props>["params"],
  });
}
Frame.definition = FrameSource.definition;
