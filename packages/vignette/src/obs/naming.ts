import { isStableId } from "../core/ids.js";

const PREFIX = "vignette";
const SEPARATOR = "/";

/**
 * The managed name of a show's registry scene, `vignette/<show>`. Every managed input is created
 * in it, disabled, so an input outlives the scene items that place it.
 */
export function registrySceneName(show: string): string {
  return [PREFIX, show].join(SEPARATOR);
}

/** The managed OBS scene name of a show scene, `vignette/<show>/<scene>`. */
export function managedSceneName(show: string, scene: string): string {
  return [PREFIX, show, scene].join(SEPARATOR);
}

/** The managed OBS input name of a show source, `vignette/<show>/<source>`. */
export function managedSourceName(show: string, source: string): string {
  return [PREFIX, show, source].join(SEPARATOR);
}

/**
 * The name of a resource a layer plugin owns, `vignette/<show>/<kind>/<name>`: inside the show's
 * namespace, so it is the show's to create and remove, but with a fourth part, so the planner
 * never manages it ({@link parseManagedName} leaves it alone).
 */
export function layerResourceName(show: string, kind: string, name: string): string {
  return [PREFIX, show, kind, name].join(SEPARATOR);
}

/**
 * Reads a name in a show's namespace: `{ id: undefined }` for the registry scene, `{ id }` for a
 * scene or input (OBS lists scenes and inputs separately, so the list says which). Anything else,
 * including another show's resources, operator-made ones and layer plugins' resources
 * ({@link layerResourceName}), is `undefined`: never managed.
 */
export function parseManagedName(name: string, show: string): ManagedName | undefined {
  const parts = name.split(SEPARATOR);
  if (parts[0] !== PREFIX || parts[1] !== show) return undefined;
  if (parts.length === 2) return { id: undefined };
  const id = parts[2];
  return parts.length === 3 && id !== undefined && isStableId(id) ? { id } : undefined;
}

/** A name in a show's namespace: the registry scene (`id` undefined), or a scene or input ID. */
export interface ManagedName {
  readonly id: string | undefined;
}
