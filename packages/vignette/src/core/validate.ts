import { z } from "zod";

import type { Serve } from "../stream/messages.js";
import { ServeSchema } from "../stream/messages.js";
import type { AssetManifest } from "./assets.js";
import type { SourceDefinition } from "./define-source.js";
import { diagnostic, sortDiagnostics, type Diagnostic } from "./diagnostics.js";
import {
  isGroupNode,
  isSourceRef,
  type LayoutNode,
  type ShowTree,
  type ShowTreeScene,
} from "./show-tree.js";
import type { Source } from "./snapshot.js";

/** What structural validation needs besides the tree: the kinds in use and the host's options. */
export interface ValidateOptions {
  /** Every source kind the show renders, keyed by kind. */
  readonly definitions: ReadonlyMap<string, SourceDefinition>;
  readonly assets?: AssetManifest;
  readonly serve?: Serve;
}

/** One source as validation sees it: its ID, kind and props. */
type SourceIdentity = Pick<Source, "id" | "kind" | "props">;

/**
 * Structural checks over a lowered show: unique IDs at each scope, `<Use>` placements, the
 * active scene, and whether the host serves what the show's kinds need. Props schemas ran during
 * lowering; this never re-validates them. Every result is an error that blocks compilation.
 */
export function validateShow(tree: ShowTree, options: ValidateOptions): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const sources: SourceIdentity[] = [...tree.sharedSources];
  const shared = new Set(tree.sharedSources.map((source) => source.id));

  for (const id of duplicates(tree.scenes.map((scene) => scene.id))) {
    diagnostics.push(
      diagnostic("DUPLICATE_SCENE_ID", "error", `scene.${id}`, `Scene ID '${id}' is used twice.`, [
        id,
      ]),
    );
  }
  for (const scene of tree.scenes) {
    sources.push(...validateScene(scene, shared, diagnostics));
  }
  for (const id of duplicates(sources.map((source) => source.id))) {
    diagnostics.push(
      diagnostic(
        "DUPLICATE_SOURCE_ID",
        "error",
        `source.${id}`,
        `Source ID '${id}' is used twice; source IDs are unique across the show.`,
        [id],
      ),
    );
  }
  if (tree.activeScene !== undefined && !tree.scenes.some(({ id }) => id === tree.activeScene)) {
    diagnostics.push(
      diagnostic(
        "UNKNOWN_ACTIVE_SCENE",
        "error",
        "show.activeScene",
        `activeScene '${tree.activeScene}' names no scene in the show.`,
        [tree.activeScene],
      ),
    );
  }
  diagnostics.push(...validateServe(sources, options), ...validateAssets(sources, options));
  return [...sortDiagnostics(diagnostics)];
}

/** Checks layer IDs and `<Use>` placements in one scene; returns its inline sources. */
function validateScene(
  scene: ShowTreeScene,
  shared: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): SourceIdentity[] {
  const layers = isGroupNode(scene.root) ? scene.root.children.flatMap(flatten) : [];
  const path = `scene.${scene.id}`;
  for (const id of duplicates(layers.map((layer) => layer.id))) {
    diagnostics.push(
      diagnostic(
        "DUPLICATE_LAYER_ID",
        "error",
        `${path}.layer.${id}`,
        `Layer ID '${id}' is used twice in scene '${scene.id}'.`,
        [scene.id, id],
      ),
    );
  }

  const inline: SourceIdentity[] = [];
  const refs: string[] = [];
  for (const layer of layers) {
    if (isGroupNode(layer)) continue;
    if (!isSourceRef(layer.source)) {
      inline.push(layer.source);
      continue;
    }
    refs.push(layer.source.ref);
    if (!shared.has(layer.source.ref)) {
      diagnostics.push(
        diagnostic(
          "MISSING_SOURCE",
          "error",
          `${path}.layer.${layer.id}`,
          `Layer '${layer.id}' uses '${layer.source.ref}', which no source in <Show> declares.`,
          [layer.id, layer.source.ref],
        ),
      );
    }
  }
  for (const ref of duplicates(refs)) {
    diagnostics.push(
      diagnostic(
        "DUPLICATE_PLACEMENT",
        "error",
        `${path}.use.${ref}`,
        `Source '${ref}' is placed twice in scene '${scene.id}'; a shared source appears at most once per scene.`,
        [scene.id, ref],
      ),
    );
  }
  return inline;
}

/**
 * `serve` must be absolute URLs, with `assets` when some source names an asset and frame
 * locations for frames.
 */
function validateServe(sources: readonly SourceIdentity[], options: ValidateOptions): Diagnostic[] {
  const parsed = ServeSchema.safeParse(options.serve ?? {});
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      diagnostic(
        "INVALID_PROPS",
        "error",
        ["serve", ...issue.path.map(String)].join("."),
        issue.message,
      ),
    );
  }
  const serve = parsed.data;
  const kinds = new Set(sources.map((source) => source.kind));
  const assetKinds = new Set(
    sources
      .filter((source) => namedAssets(source, options.definitions).length > 0)
      .map((source) => source.kind),
  );
  const missing: Diagnostic[] = [];
  if (assetKinds.size > 0 && serve.assets === undefined) {
    missing.push(missingServe("assets", `the ${[...assetKinds].sort().join(", ")} kind`));
  }
  if (kinds.has("frame")) {
    if (serve.frames === undefined) missing.push(missingServe("frames", "a <Frame>"));
    if (serve.stream === undefined) missing.push(missingServe("stream", "a <Frame>"));
  }
  return missing;
}

function missingServe(key: keyof Serve, user: string): Diagnostic {
  return diagnostic(
    "MISSING_SERVE",
    "error",
    `serve.${key}`,
    `The show uses ${user}, so compose() needs serve.${key}: the absolute URL it is served at.`,
  );
}

/** A prop value that names an asset. */
const AssetNameSchema = z.string();
/** A prop value that names an asset. */
type AssetName = z.output<typeof AssetNameSchema>;

/** Every asset name a source names must be in the manifest. */
function validateAssets(
  sources: readonly SourceIdentity[],
  options: ValidateOptions,
): Diagnostic[] {
  const names = new Set(options.assets?.entries.map((entry) => entry.name));
  return sources.flatMap((source) =>
    namedAssets(source, options.definitions)
      .filter(({ name }) => !names.has(name))
      .map(({ key, name }) =>
        diagnostic(
          "MISSING_ASSET",
          "error",
          `source.${source.id}.props.${key}`,
          `Asset '${name}' is not in the asset manifest passed to compose().`,
          [source.id],
        ),
      ),
  );
}

/** An asset a source names: the prop holding it and the name. */
interface NamedAsset {
  readonly key: string;
  readonly name: AssetName;
}

/**
 * The assets one source names: each asset-bearing prop of its kind with a string value. Props
 * without a string value (an optional asset left out) name nothing and are skipped.
 */
function namedAssets(
  source: SourceIdentity,
  definitions: ValidateOptions["definitions"],
): NamedAsset[] {
  return (definitions.get(source.kind)?.assets ?? []).flatMap((key) => {
    const parsed = AssetNameSchema.safeParse(source.props[key]);
    return parsed.success ? [{ key, name: parsed.data }] : [];
  });
}

function flatten(node: LayoutNode): LayoutNode[] {
  return isGroupNode(node) ? [node, ...node.children.flatMap(flatten)] : [node];
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}
