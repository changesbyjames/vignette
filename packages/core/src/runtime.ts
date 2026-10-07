import type { ProjectId, SceneId } from "./ids.js";
import type { CompiledSnapshot } from "./snapshot.js";
import type { SourceModuleEntrypoints } from "./source-module.js";

interface RuntimeSetupMessage extends RuntimeSetup {
  readonly kind: "setup";
}

interface RuntimeUpdateMessage {
  readonly kind: "update";
  readonly snapshot: CompiledSnapshot;
}

interface RuntimeEventMessage {
  readonly kind: "event";
  readonly event: RuntimeEvent;
}

/** One downloadable project asset advertised to runtimes. */
export interface AssetManifestEntry {
  readonly name: string;
  readonly url: string;
  readonly integrity?: `sha256-${string}`;
}

/** Versioned collection of assets required by runtime snapshots. */
export interface AssetManifest {
  readonly version: 1 | `sha256-${string}`;
  readonly assets: readonly AssetManifestEntry[];
}

/**
 * One extension source kind registered by a composition, advertised so targets can verify they
 * implement it before any snapshot arrives.
 */
export interface ExtensionSourceKind {
  readonly kind: `source:${string}`;
  /** Target entrypoints that implement the kind, used to make diagnostics actionable. */
  readonly entrypoints?: SourceModuleEntrypoints;
}

/** Composition identity and requirements announced to a runtime before any snapshot. */
export interface RuntimeSetup {
  /** The composition's project ID; snapshots in the same stream carry the same ID. */
  readonly projectId: ProjectId;
  readonly manifest: AssetManifest;
  /** Extension source kinds the composer registered; built-in kinds are never listed. */
  readonly extensions: readonly ExtensionSourceKind[];
}

/** One-shot command delivered separately from stable desired state. */
export interface RuntimeEvent {
  readonly id: string;
  readonly kind: "scene:select";
  readonly sceneId: SceneId;
}

/** Setup, snapshot update, or one-shot event sent to a runtime. */
export type RuntimeMessage = RuntimeSetupMessage | RuntimeUpdateMessage | RuntimeEventMessage;

/** Consumer contract shared by DOM, OBS, and test runtimes. */
export interface SnapshotRuntime {
  setup(setup: RuntimeSetup): Promise<void>;
  update(snapshot: CompiledSnapshot): void;
  event(event: RuntimeEvent): void | Promise<void>;
  dispose(): Promise<void>;
}

/**
 * A transport that delivers runtime messages to a consumer. Implementations own connection
 * details (SSE, websockets, in-memory buses); runtimes stay transport-agnostic.
 */
export interface RuntimeMessageSource {
  (signal: AbortSignal): AsyncIterable<RuntimeMessage>;
  /**
   * The URL this transport reads from, when it has one (possibly relative to the consumer's
   * document). Runtimes may use it as the default base for root-relative snapshot URLs.
   */
  readonly url?: string;
}

/** Sequentially applies a runtime message stream until it ends or fails. */
export async function consumeRuntimeMessages(
  runtime: SnapshotRuntime,
  messages: AsyncIterable<RuntimeMessage>,
): Promise<void> {
  for await (const message of messages) {
    switch (message.kind) {
      case "setup":
        await runtime.setup({
          projectId: message.projectId,
          manifest: message.manifest,
          extensions: message.extensions,
        });
        break;
      case "update":
        runtime.update(message.snapshot);
        break;
      case "event":
        await runtime.event(message.event);
        break;
    }
  }
}

/** What each target registers to implement an extension source kind. */
const TARGET_EXTENSION_LABELS = {
  dom: "a DOM renderer",
  obs: "an OBS codec",
} as const;

/**
 * Describes the advertised extension source kinds a target cannot render, or returns undefined
 * when every kind is available. Built-in kinds are never advertised, so `available` only needs to
 * contain the target's registered kinds.
 */
export function describeMissingExtensions(
  extensions: readonly ExtensionSourceKind[],
  available: ReadonlySet<string>,
  target: keyof SourceModuleEntrypoints,
): string | undefined {
  const missing = extensions.filter((extension) => !available.has(extension.kind));
  if (missing.length === 0) return undefined;
  return missing
    .map((extension) => {
      const entrypoint = extension.entrypoints?.[target];
      const remedy =
        entrypoint === undefined
          ? `register ${TARGET_EXTENSION_LABELS[target]} for it`
          : `register ${entrypoint}`;
      return `Stream requires source kind '${extension.kind}'; ${remedy}.`;
    })
    .join(" ");
}
