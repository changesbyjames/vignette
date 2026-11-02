import { z } from "zod";
import type { ComponentType } from "react";

/** Raw parameters belong to the schema that will decode them. */
export type FrameParamsInput<Params extends object> = z.input<z.ZodType<Params>>;

/** Parser contract used to validate frame parameters, in the show and again in the page. */
export interface FrameParamsSchema<Params extends object> {
  parse(input: FrameParamsInput<Params>): Params;
}

/** Name, parameter schema and React component of a frame with parameters. */
export interface FrameOptions<Params extends object> {
  /** Identifies the frame in snapshots and in `frames.html?frame=`; unique within a bundle. */
  readonly name: string;
  readonly params: FrameParamsSchema<Params>;
  readonly view: ComponentType<Params>;
}

/** Accepts only an empty parameter object, for frames defined without a `params` schema. */
export const NoFrameParamsSchema = z.object({}).strict();
/** Parameters of a frame defined without a `params` schema. */
export type NoFrameParams = z.output<typeof NoFrameParamsSchema>;

/** Options for a frame without parameters; `<Frame of>` placements then omit `params`. */
export interface ParameterlessFrameOptions {
  readonly name: string;
  readonly params?: undefined;
  readonly view: ComponentType;
}

/** Typed frame definition consumed by `<Frame of>` and `mountFrames`. */
export interface FrameDefinition<Params extends object> {
  readonly name: string;
  readonly params: FrameParamsSchema<Params>;
  readonly view: ComponentType<Params>;
}

const noFrameParams: FrameParamsSchema<NoFrameParams> = {
  parse: (input) => NoFrameParamsSchema.parse(input ?? {}),
};

/**
 * Defines a frame: a React DOM component that becomes a web page placed as a source. Omit
 * `params` for a frame without parameters; its `<Frame of>` placements then omit `params` too.
 */
export function frame(options: ParameterlessFrameOptions): FrameDefinition<NoFrameParams>;
export function frame<Params extends object>(
  options: FrameOptions<Params>,
): FrameDefinition<Params>;
export function frame<Params extends object>(
  options: FrameOptions<Params> | ParameterlessFrameOptions,
): FrameDefinition<Params> {
  // SAFETY: The parameterless overload fixes Params to NoFrameParams, which this schema produces.
  const fallbackParams = noFrameParams as FrameParamsSchema<Params>;
  // SAFETY: The overloads pair each view with the parameters its schema produces.
  const view = options.view as ComponentType<Params>;
  // oxlint-disable-next-line house/no-object-freeze -- Frame definitions cross the user-to-authoring ownership boundary.
  return Object.freeze({ name: options.name, params: options.params ?? fallbackParams, view });
}
