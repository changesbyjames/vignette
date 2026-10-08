import { z } from "zod";
import { omitUndefined } from "@strangecyan/vignette-core";
import type { ComponentType } from "react";

/** Raw parameters belong to the schema that will decode them. */
export type FrameParamsInput<Params extends object> = z.input<z.ZodType<Params>>;

/** Parser contract used to validate serialized frame parameters. */
export interface FrameParamsSchema<Params extends object> {
  parse(input: FrameParamsInput<Params>): Params;
}

/** Parameter schema and React component used to define a frame. */
export interface FrameOptions<Params extends object> {
  readonly params: FrameParamsSchema<Params>;
  readonly view: ComponentType<Params>;
  /** Client route metadata for hosts that do not use a build transform. */
  readonly metadata?: FrameMetadata | undefined;
}

/** Accepts only an empty parameter object, for frames defined without a `params` schema. */
export const NoFrameParamsSchema = z.object({}).strict();
/** Parameters of a frame defined without a `params` schema. */
export type NoFrameParams = z.output<typeof NoFrameParamsSchema>;

/** Options for a frame without parameters; `<View>` placements then omit `params`. */
export interface ParameterlessFrameOptions {
  readonly params?: undefined;
  readonly view: ComponentType;
  /** Client route metadata for hosts that do not use a build transform. */
  readonly metadata?: FrameMetadata | undefined;
}

/** Defines frames with a typed parameter schema, or without parameters. */
export interface FrameBuilder {
  (options: ParameterlessFrameOptions): FrameDefinition<NoFrameParams>;
  <Params extends object>(options: FrameOptions<Params>): FrameDefinition<Params>;
}

export interface FrameMetadata {
  readonly routeKey: string;
  readonly moduleUrl: string;
  readonly exportName: string;
}

/** Typed frame definition consumed by `<View>` and frame hosts. */
export interface FrameDefinition<Params extends object> {
  readonly params: FrameParamsSchema<Params>;
  readonly view: ComponentType<Params>;
  readonly metadata?: FrameMetadata;
}

interface FrameFactory extends FrameBuilder {
  withMetadata(metadata: FrameMetadata): FrameBuilder;
  /** @deprecated Use `frame.withMetadata()` or the `metadata` frame option. */
  __withMetadata(metadata: FrameMetadata): FrameBuilder;
}

const noFrameParams: FrameParamsSchema<NoFrameParams> = {
  parse: (input) => NoFrameParamsSchema.parse(input ?? {}),
};

type AnyFrameOptions<Params extends object> = FrameOptions<Params> | ParameterlessFrameOptions;

function defineFrame<Params extends object>(
  options: AnyFrameOptions<Params>,
  metadata: FrameMetadata | undefined = options.metadata,
): FrameDefinition<Params> {
  // SAFETY: Parameterless overloads fix Params to NoFrameParams, which this schema produces.
  const fallbackParams = noFrameParams as FrameParamsSchema<Params>;
  const params = options.params ?? fallbackParams;
  // SAFETY: The overloads pair each view with the parameters its schema produces.
  const view = options.view as ComponentType<Params>;
  // oxlint-disable-next-line house/no-object-freeze -- Frame definitions cross the user-to-authoring ownership boundary.
  return Object.freeze({
    params,
    view,
    ...omitUndefined({
      metadata: metadata === undefined ? undefined : freezeFrameMetadata(metadata),
    }),
  });
}

function frameBuilder(metadata?: FrameMetadata): FrameBuilder {
  return <Params extends object>(options: AnyFrameOptions<Params>) =>
    defineFrame(options, metadata ?? options.metadata);
}

/**
 * Defines a typed React DOM frame for placement in Vignette scenes. Omit `params` for a frame
 * without parameters; its `<View>` placements then omit `params` too.
 */
export const frame: FrameFactory = Object.assign(frameBuilder(), {
  withMetadata: (metadata: FrameMetadata) => frameBuilder(metadata),
  __withMetadata: (metadata: FrameMetadata) => frameBuilder(metadata),
});

function freezeFrameMetadata(metadata: FrameMetadata): FrameMetadata {
  // oxlint-disable-next-line house/no-object-freeze -- Clone user-owned route metadata before making the frame definition immutable.
  return Object.freeze({ ...metadata });
}

export const FrameCandidateSchema = z.object({
  params: z.object({ parse: z.instanceof(Function) }),
  view: z.instanceof(Function),
});
export type FrameCandidate = z.output<typeof FrameCandidateSchema>;

/** Decode the executable members before treating a module export as a frame. */
export function isFrameDefinition(
  value: FrameParamsInput<object>,
): value is FrameDefinition<object> {
  return FrameCandidateSchema.safeParse(value).success;
}
