const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

declare const projectIdBrand: unique symbol;
declare const sceneIdBrand: unique symbol;
declare const sourceIdBrand: unique symbol;
declare const layerIdBrand: unique symbol;

export type ProjectId = string & { readonly [projectIdBrand]: "ProjectId" };
export type SceneId = string & { readonly [sceneIdBrand]: "SceneId" };
export type SourceId = string & { readonly [sourceIdBrand]: "SourceId" };
export type LayerId = string & { readonly [layerIdBrand]: "LayerId" };

export type StableId = ProjectId | SceneId | SourceId | LayerId;
export type StableIdKind = "project" | "scene" | "source" | "layer";

export interface InvalidStableId {
  readonly kind: StableIdKind;
  readonly value: string;
  readonly reason: string;
}

export type StableIdResult<T extends StableId> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: InvalidStableId };

export function isStableId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function parseProjectId(value: string): StableIdResult<ProjectId> {
  return parseId("project", value, (id) => id as ProjectId);
}

export function parseSceneId(value: string): StableIdResult<SceneId> {
  return parseId("scene", value, (id) => id as SceneId);
}

export function parseSourceId(value: string): StableIdResult<SourceId> {
  return parseId("source", value, (id) => id as SourceId);
}

export function parseLayerId(value: string): StableIdResult<LayerId> {
  return parseId("layer", value, (id) => id as LayerId);
}

export function projectId(value: string): ProjectId {
  return unwrapId(parseProjectId(value));
}

export function sceneId(value: string): SceneId {
  return unwrapId(parseSceneId(value));
}

export function sourceId(value: string): SourceId {
  return unwrapId(parseSourceId(value));
}

export function layerId(value: string): LayerId {
  return unwrapId(parseLayerId(value));
}

function parseId<T extends StableId>(
  kind: StableIdKind,
  value: string,
  brand: (valid: string) => T,
): StableIdResult<T> {
  if (value.length === 0) {
    return invalid(kind, value, "ID must not be empty.");
  }

  if (value !== value.trim()) {
    return invalid(kind, value, "ID must not contain leading or trailing whitespace.");
  }

  if (!ID_PATTERN.test(value)) {
    return invalid(
      kind,
      value,
      "ID must start with an alphanumeric character and contain only letters, numbers, '.', '_' or '-'.",
    );
  }

  return { ok: true, value: brand(value) };
}

function invalid<T extends StableId>(
  kind: StableIdKind,
  value: string,
  reason: string,
): StableIdResult<T> {
  return { ok: false, error: { kind, value, reason } };
}

function unwrapId<T extends StableId>(result: StableIdResult<T>): T {
  if (result.ok) return result.value;
  throw new TypeError(
    `${result.error.kind} ID '${result.error.value}' is invalid: ${result.error.reason}`,
  );
}
