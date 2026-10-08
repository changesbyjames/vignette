import type { BroadcastCanvas, SourceModule } from "@strangecyan/vignette-core";
import type { ComponentType } from "react";

/**
 * Everything that identifies one Vignette composition: its project ID (the OBS namespace and the
 * identity advertised to every runtime), fixed canvas, extension source modules, and the React
 * component that renders it.
 *
 * By convention a composition module (for example `src/show.tsx`) exports one definition as the
 * named export `composition`, so hosts and tooling can load it by module path.
 */
export interface CompositionDefinition {
  /** Project ID; scopes managed OBS resources and is sent to runtimes in the setup message. */
  readonly id: string;
  readonly canvas: BroadcastCanvas;
  /** Source modules contributed by extension packages (built-ins are always registered). */
  readonly extensions?: readonly SourceModule[];
  /** Top-level component; `ComposerRoot.render()` renders it when no element is supplied. */
  readonly component: ComponentType;
}

/**
 * Defines a composition. The definition is cloned and frozen so hosts can share it safely:
 *
 * ```tsx
 * export const composition = defineComposition({
 *   id: "weekly-show",
 *   canvas: { width: 1920, height: 1080, frameRate: 60 },
 *   component: Show,
 * });
 * ```
 */
export function defineComposition(definition: CompositionDefinition): CompositionDefinition {
  // oxlint-disable-next-line house/no-object-freeze -- Composition definitions cross the user-to-authoring ownership boundary.
  return Object.freeze({
    id: definition.id,
    // oxlint-disable-next-line house/no-object-freeze -- Clone the user-owned canvas before sharing it with every root.
    canvas: Object.freeze({ ...definition.canvas }),
    // oxlint-disable-next-line house/no-object-freeze -- Extension modules are shared; only the list is cloned and frozen.
    extensions: Object.freeze([...(definition.extensions ?? [])]),
    component: definition.component,
  });
}
