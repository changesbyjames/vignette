import type { SceneId } from "./ids.js";
import type { CompiledSnapshot } from "./snapshot.js";

export interface AssetManifestEntry {
  readonly name: string;
  readonly url: string;
  readonly integrity?: `sha256-${string}`;
}

export interface AssetManifest {
  readonly version: 1;
  readonly assets: readonly AssetManifestEntry[];
}

export interface RuntimeEvent {
  readonly id: string;
  readonly kind: "scene:select";
  readonly sceneId: SceneId;
}

export type RuntimeMessage =
  | { readonly kind: "setup"; readonly manifest: AssetManifest }
  | { readonly kind: "update"; readonly snapshot: CompiledSnapshot }
  | { readonly kind: "event"; readonly event: RuntimeEvent };

export interface SnapshotRuntime {
  setup(manifest: AssetManifest): Promise<void>;
  update(snapshot: CompiledSnapshot): void;
  event(event: RuntimeEvent): void | Promise<void>;
  dispose(): Promise<void>;
}

/**
 * A transport that delivers runtime messages to a consumer. Implementations own connection
 * details (SSE, websockets, in-memory buses); runtimes stay transport-agnostic.
 */
export type RuntimeMessageSource = (signal: AbortSignal) => AsyncIterable<RuntimeMessage>;

export async function consumeRuntimeMessages(
  runtime: SnapshotRuntime,
  messages: AsyncIterable<RuntimeMessage>,
): Promise<void> {
  for await (const message of messages) {
    switch (message.kind) {
      case "setup":
        await runtime.setup(message.manifest);
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
