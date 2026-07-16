import type { ComponentType } from "react";

/** Parser contract used to validate serialized frame parameters. */
export interface FrameParamsSchema<Params extends object> {
  parse(input: unknown): Params;
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
  return Object.freeze({
    params: options.params,
    view: options.view,
    ...(metadata === undefined ? {} : { metadata: Object.freeze(metadata) }),
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

/** Tests whether a value has the structural frame-definition contract. */
export function isFrameDefinition(value: unknown): value is FrameDefinition<object> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FrameDefinition<object>>;
  return typeof candidate.params?.parse === "function" && typeof candidate.view === "function";
}
