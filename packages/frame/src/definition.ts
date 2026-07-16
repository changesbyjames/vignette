import type { ComponentType } from "react";

export interface FrameParamsSchema<Params extends object> {
  parse(input: unknown): Params;
}

export interface FrameOptions<Params extends object> {
  readonly params: FrameParamsSchema<Params>;
  readonly view: ComponentType<Params>;
}

export interface FrameMetadata {
  readonly routeKey: string;
  readonly moduleUrl: string;
  readonly exportName: string;
}

export interface FrameDefinition<Params extends object> {
  readonly params: FrameParamsSchema<Params>;
  readonly view: ComponentType<Params>;
  readonly metadata?: FrameMetadata;
}

interface FrameFactory {
  <Params extends object>(options: FrameOptions<Params>): FrameDefinition<Params>;
  __withMetadata(
    metadata: FrameMetadata,
  ): <Params extends object>(options: FrameOptions<Params>) => FrameDefinition<Params>;
}

function defineFrame<Params extends object>(
  options: FrameOptions<Params>,
  metadata?: FrameMetadata,
): FrameDefinition<Params> {
  return Object.freeze({
    params: options.params,
    view: options.view,
    ...(metadata === undefined ? {} : { metadata: Object.freeze(metadata) }),
  });
}

export const frame: FrameFactory = Object.assign(
  <Params extends object>(options: FrameOptions<Params>) => defineFrame(options),
  {
    __withMetadata:
      (metadata: FrameMetadata) =>
      <Params extends object>(options: FrameOptions<Params>) =>
        defineFrame(options, metadata),
  },
);

export function isFrameDefinition(value: unknown): value is FrameDefinition<object> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FrameDefinition<object>>;
  return typeof candidate.params?.parse === "function" && typeof candidate.view === "function";
}
