import type { Snapshot } from "../core/snapshot.js";
import type { SetupMessage, ShowEvent, StreamMessage } from "../stream/messages.js";
import { fromSse } from "../stream/sse.js";
import { createTarget } from "../target/kernel.js";
import type { TargetConnection, TargetStatus } from "../target/status.js";
import type { ReactSourcePlugin } from "./plugin.js";
import { createSharedSources, type SharedSources } from "./shared.js";

/** Everything `<Stream>` provides, as one immutable value per change. */
export interface StreamState {
  readonly setup?: SetupMessage;
  readonly snapshot?: Snapshot;
  readonly status: TargetStatus;
}

/** Where `<Stream>` reads messages from. */
export interface StreamInput {
  readonly url?: string;
  readonly source?: AsyncIterable<StreamMessage>;
}

/** What `<Stream>` hands the target when it connects. */
export interface ConnectOptions {
  readonly plugins: readonly ReactSourcePlugin[];
  readonly checkPlugins: boolean;
}

/** Receives each show event of the stream. */
export type StreamEventListener = (event: ShowEvent) => void;

/** The external store behind one `<Stream>`; it outlives reconnections. */
export interface StreamClient {
  readonly state: StreamState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Follows `input` with a new target until the returned function is called. */
  connect(input: StreamInput, options: ConnectOptions): () => void;
  listen(listener: StreamEventListener): () => void;
  /** Resolves with the first setup message, for components that suspend until it arrives. */
  readonly setup: Promise<SetupMessage>;
  readonly shared: SharedSources;
}

/** Creates the store of one `<Stream>`. */
export function createStreamClient(): StreamClient {
  const listeners = new Set<() => void>();
  const events = new Set<StreamEventListener>();
  let state: StreamState = {
    status: { phase: "connecting", revision: {}, sources: {}, sourceErrors: {} },
  };
  let resolveSetup: (setup: SetupMessage) => void = () => undefined;
  const firstSetup = new Promise<SetupMessage>((resolve) => {
    resolveSetup = resolve;
  });

  function set(next: StreamState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    get state() {
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listen(listener) {
      events.add(listener);
      return () => {
        events.delete(listener);
      };
    },
    setup: firstSetup,
    shared: createSharedSources(),
    connect({ url, source }, { plugins, checkPlugins }) {
      if (url === undefined && source === undefined) {
        throw new Error("<Stream> needs a `url` or a `source`.");
      }
      let active = true;
      const abort = new AbortController();
      // `fromSse` reports its connection; the kernel shows the latest as `status.connection`.
      let connection: TargetConnection | undefined = undefined;
      let report: (next: TargetConnection) => void = () => undefined;
      const target = createTarget({
        kind: "react",
        // Rendering is React's, so a handle is an empty record; the kernel still checks setup
        // kinds against the plugins and tracks each source's status.
        sources: plugins.map((plugin) => ({ kind: plugin.kind, create: () => ({}) })),
        checkPlugins,
        // No asset store: the kernel skips its asset stage and `useAsset` downloads through
        // TanStack Query instead, so nothing is downloaded twice.
        connection(next) {
          report = next;
          if (connection !== undefined) report(connection);
          return () => {
            report = () => undefined;
          };
        },
        update(snapshot) {
          if (active) set({ ...state, snapshot });
        },
        event(event) {
          if (!active) return;
          for (const listener of events) listener(event);
        },
      });
      const publish = () => {
        if (active) set({ ...state, status: streamStatus(target.status) });
      };
      const unsubscribe = target.subscribe(publish);
      publish();
      const messages =
        source ??
        fromSse(url ?? "", {
          signal: abort.signal,
          onConnection: (next) => {
            connection = next;
            report(next);
          },
        });
      const stop = target.follow(
        withSetup(messages, (setup) => {
          if (!active) return;
          set({ ...state, setup });
          resolveSetup(setup);
        }),
      );
      return () => {
        active = false;
        abort.abort();
        stop();
        unsubscribe();
        void target.dispose();
      };
    },
  };
}

/** Passes every message through, reporting each setup first. */
async function* withSetup(
  stream: AsyncIterable<StreamMessage>,
  onSetup: (setup: SetupMessage) => void,
): AsyncGenerator<StreamMessage> {
  for await (const message of stream) {
    if (message.kind === "setup") onSetup(message);
    yield message;
  }
}

/** Before the first message the kernel is `idle`; a page reads that as connecting, or gone. */
function streamStatus(status: TargetStatus): TargetStatus {
  if (status.phase !== "idle") return status;
  const phase = status.connection?.phase === "closed" ? "disconnected" : "connecting";
  return { ...status, phase };
}
