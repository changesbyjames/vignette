import {
  isStableId,
  projectId,
  sceneId,
  sourceId,
  type ProjectId,
  type SceneId,
  type SourceId,
} from "@strangecyan/vignette-core";

const PREFIX = "vignette";
const SEPARATOR = "::";

/** Parsed identity of an OBS resource managed by Vignette. */
export type ManagedObsName =
  | { readonly kind: "registry"; readonly projectId: ProjectId }
  | { readonly kind: "scene"; readonly projectId: ProjectId; readonly sceneId: SceneId }
  | { readonly kind: "source"; readonly projectId: ProjectId; readonly sourceId: SourceId };

/** Returns the managed OBS registry-scene name for a project. */
export function registrySceneName(project: ProjectId): string {
  return [PREFIX, project, "registry"].join(SEPARATOR);
}

/** Returns the managed OBS scene name for a Vignette scene. */
export function managedSceneName(project: ProjectId, scene: SceneId): string {
  return [PREFIX, project, "scene", scene].join(SEPARATOR);
}

/** Returns the managed OBS input name for a Vignette source. */
export function managedSourceName(project: ProjectId, source: SourceId): string {
  return [PREFIX, project, "source", source].join(SEPARATOR);
}

/** Parses a managed OBS name, returning `undefined` for external resources. */
export function parseManagedName(name: string): ManagedObsName | undefined {
  const parts = name.split(SEPARATOR);
  if (parts[0] !== PREFIX || parts[1] === undefined || !isStableId(parts[1])) return undefined;
  const parsedProject = projectId(parts[1]);

  if (parts.length === 3 && parts[2] === "registry") {
    return { kind: "registry", projectId: parsedProject };
  }
  if (parts.length !== 4 || parts[3] === undefined || !isStableId(parts[3])) return undefined;
  if (parts[2] === "scene") {
    return { kind: "scene", projectId: parsedProject, sceneId: sceneId(parts[3]) };
  }
  if (parts[2] === "source") {
    return { kind: "source", projectId: parsedProject, sourceId: sourceId(parts[3]) };
  }
  return undefined;
}

/** Tests whether an OBS resource name belongs to one managed project. */
export function belongsToProject(name: string, project: ProjectId): boolean {
  return parseManagedName(name)?.projectId === project;
}
