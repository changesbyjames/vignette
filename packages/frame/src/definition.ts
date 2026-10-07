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
  readonly metadata?: FrameMetadata;
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

interface FrameFactory {
  <Params extends object>(options: FrameOptions<Params>): FrameDefinition<Params>;
  withMetadata(
    metadata: FrameMetadata,
  ): <Params extends object>(options: FrameOptions<Params>) => FrameDefinition<Params>;
  /** @deprecated Use `frame.withMetadata()` or the `metadata` frame option. */
  __withMetadata(
    metadata: FrameMetadata,
  ): <Params extends object>(options: FrameOptions<Params>) => FrameDefinition<Params>;
}

function defineFrame<Params extends object>(
  options: FrameOptions<Params>,
  metadata: FrameMetadata | undefined = options.metadata,
): FrameDefinition<Params> {
  // oxlint-disable-next-line house/no-object-freeze -- Frame definitions cross the user-to-authoring ownership boundary.
  return Object.freeze({
    params: options.params,
    view: options.view,
    ...omitUndefined({
      metadata: metadata === undefined ? undefined : freezeFrameMetadata(metadata),
    }),
  });
}

/** Defines a typed React DOM frame for placement in Vignette scenes. */
export const frame: FrameFactory = Object.assign(
  <Params extends object>(options: FrameOptions<Params>) => defineFrame(options),
  {
    withMetadata:
      (metadata: FrameMetadata) =>
      <Params extends object>(options: FrameOptions<Params>) =>
        defineFrame(options, metadata),
    __withMetadata:
      (metadata: FrameMetadata) =>
      <Params extends object>(options: FrameOptions<Params>) =>
        defineFrame(options, metadata),
  },
);

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
