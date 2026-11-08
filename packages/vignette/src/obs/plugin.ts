import type { ShowEvent } from "../stream/messages.js";
import type { PluginContextBase, SourceOf, SourcePluginBase } from "../target/plugins.js";
import type { ObsJsonObject } from "./operations.js";

/** What a plugin asks OBS to create for its source: an input kind and its settings. */
export interface ObsInput {
  /** An OBS input kind, e.g. `browser_source`; see `inputKinds` in the plugin context. */
  readonly kind: string;
  /** The input's settings; the target converges them with `SetInputSettings`. */
  readonly settings: ObsJsonObject;
  /** Audio mute state, converged with `SetInputMute`. Omit for inputs without audio. */
  readonly muted?: boolean;
}

/**
 * One live source in the OBS target: the input it becomes, and the lifetime members the kernel
 * calls. `input` is read on every convergence, so a handle may change it in `update`. A handle
 * without `update` is re-created for changed props: `create` runs again and the old handle is
 * disposed. `Def` is the source component, e.g. `ObsHandle<typeof Moq>`, which types `update`.
 */
export interface ObsHandle<Def = unknown> {
  readonly input: ObsInput;
  /** The same source ID arrived with changed props or size. */
  update?(source: SourceOf<Def>): void | Promise<void>;
  /** The source ID is gone, or the target is disposed. */
  dispose?(): void | Promise<void>;
  /** A show event addressed to this source, or to no source in particular. */
  event?(event: ShowEvent): void | Promise<void>;
}

/** What an OBS plugin receives: the base context plus what it needs to choose and run an input. */
export interface ObsPluginContext extends PluginContextBase {
  /** Input kinds the connected OBS advertises. `create` runs after OBS was first observed. */
  readonly inputKinds: ReadonlySet<string>;
  /** A free local TCP port, for plugins that spawn processes OBS reads from. */
  port(): Promise<number>;
  /**
   * A path for a file OBS loads for a source, e.g. a page: the same on every run, and never
   * deleted, so the scene collection OBS saved still finds it when the target is not running.
   * `extension` includes the dot. Creates the file's directory, not the file.
   */
  sourceFile(sourceId: string, extension: string): Promise<string>;
  /**
   * Sends one obs-websocket request about a source's managed input, with its `inputName` filled
   * in, e.g. `TriggerMediaInputAction`. Rejects with an `ObsDisconnectedError` while OBS is
   * disconnected.
   */
  request(
    sourceId: string,
    requestType: string,
    requestData?: ObsJsonObject,
  ): Promise<ObsJsonObject>;
}

/**
 * Renders one source kind in OBS. `create` runs when a source ID first appears; it may be
 * asynchronous and own an external process, and the source shows as `preparing` meanwhile.
 */
export interface ObsSourcePlugin<Def = unknown> extends SourcePluginBase {
  /** Runs once before the plugin's first `create`. */
  load?(): Promise<void>;
  create(
    source: SourceOf<Def>,
    context: ObsPluginContext,
  ): ObsHandle<Def> | Promise<ObsHandle<Def>>;
}
