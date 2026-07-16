/**
 * Node composer host that serves runtime SSE and typed frame routes.
 *
 * @module
 */
import {
  consumeRuntimeMessages,
  encodeRuntimeMessageSse,
  RuntimeMessageHub,
  type AssetManifest,
  type BroadcastCanvas,
  type ProjectId,
  type RuntimeMessage,
  type SnapshotRuntime,
  type SourceModule,
} from "@cbj/vignette-core";
import { FrameProvider, FrameRegistrarProvider } from "@cbj/vignette-frame";
import {
  createFrameRequestHandler,
  FrameRouteRegistry,
  type ModuleHost,
  type NodeRequestHandler,
} from "@cbj/vignette-frame/server";
import { createComposerRoot } from "@cbj/vignette";
import type { ServerResponse } from "node:http";
import { createElement, type ReactElement } from "react";

/** Composer, frame, manifest, and runtime options owned by a persistent host. */
export interface ComposerHostOptions {
  readonly projectId: ProjectId;
  readonly canvas: BroadcastCanvas;
  readonly extensions?: readonly SourceModule[];
  /** The scene to compose, or a factory for hosts that must load it asynchronously. */
  readonly scene: ReactElement | (() => ReactElement | Promise<ReactElement>);
  /**
   * Public origin frames are served from. When set, the host wraps the scene in a
   * `<FrameProvider>` so scenes need no origin plumbing of their own.
   */
  readonly frameOrigin?: string;
  /** Client-module resolution for frame hydration. Supplied by the dev/production bindings. */
  readonly frames?: ModuleHost;
  readonly frameRegistry?: FrameRouteRegistry;
  readonly manifest: AssetManifest;
}

/** Dispatched by {@link ComposerHost} for asynchronous composer and runtime failures. */
export class ComposerErrorEvent extends Event {
  constructor(readonly error: Error) {
    super("error");
  }
}

interface RuntimeConnection {
  readonly runtime: SnapshotRuntime;
  consumer: Promise<void> | undefined;
}

/**
 * Hosts a composer root, its runtime message hub, and the HTTP surface (`/runtime` SSE and frame
 * routes). Asynchronous failures are observable as `"error"` events, never thrown into React.
 */
export class ComposerHost extends EventTarget {
  readonly hub: RuntimeMessageHub = new RuntimeMessageHub();

  readonly #options: ComposerHostOptions;
  readonly #root: ReturnType<typeof createComposerRoot>;
  readonly #unsubscribeSnapshots: () => void;
  readonly #frameRegistry: FrameRouteRegistry;
  readonly #handleFrameRequest: NodeRequestHandler;
  readonly #connections: RuntimeConnection[] = [];
  #hasErrorListener = false;
  #closed = false;
  #started = false;
  #startPromise: Promise<void> | undefined;
  #closePromise: Promise<void> | undefined;

  constructor(options: ComposerHostOptions) {
    super();
    this.#options = options;
    this.hub.publish({ kind: "setup", manifest: options.manifest });

    this.#root = createComposerRoot({
      projectId: options.projectId,
      canvas: options.canvas,
      ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
      onError: (error) => {
        this.#reportError(error);
      },
    });
    this.#unsubscribeSnapshots = this.#root.subscribe((snapshot) => {
      this.hub.publish({ kind: "update", snapshot });
    });

    this.#frameRegistry = options.frameRegistry ?? new FrameRouteRegistry();
    this.#handleFrameRequest = createFrameRequestHandler(
      options.frames ?? createUnconfiguredModuleHost(),
      this.#frameRegistry,
    );
  }

  /**
   * Connects a runtime to the hub and transfers its ownership to the host: `close()` disposes it.
   * Runtimes connected before `start()` are queued so setup cannot perform I/O before the host's
   * HTTP server is ready. Runtimes connected after startup receive the hub's replay immediately.
   */
  connect(runtime: SnapshotRuntime): void {
    if (this.#closed) throw new Error("Composer host is closed.");
    const connection: RuntimeConnection = { runtime, consumer: undefined };
    this.#connections.push(connection);
    if (this.#started) this.#activate(connection);
  }

  start(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#startPromise ??= (async () => {
      const { scene } = this.#options;
      const resolved = typeof scene === "function" ? await scene() : scene;
      if (this.#closed) return;
      // Placed <View>s register their frame routes during render, so no module lists are needed.
      let element: ReactElement = createElement(FrameRegistrarProvider, {
        register: (definition) => {
          this.#frameRegistry.registerDefinition(definition);
        },
        children: resolved,
      });
      if (this.#options.frameOrigin !== undefined) {
        element = createElement(FrameProvider, {
          origin: this.#options.frameOrigin,
          children: element,
        });
      }
      await this.#root.render(element);
      if (this.#isClosed()) return;
      this.#started = true;
      for (const connection of this.#connections) this.#activate(connection);
    })();
    return this.#startPromise;
  }

  close(): Promise<void> {
    this.#closePromise ??= (async () => {
      this.#closed = true;
      this.#unsubscribeSnapshots();
      this.hub.close();

      try {
        await this.#startPromise;
      } catch {
        // Startup failures remain observable to start callers; shutdown must still release resources.
      }

      const rootResult = await settle(this.#root.dispose());
      await Promise.all(
        this.#connections.map((connection) => connection.consumer ?? Promise.resolve()),
      );
      const runtimeResults = await Promise.all(
        this.#connections.map((connection) => settle(connection.runtime.dispose())),
      );
      const failure = rootResult ?? runtimeResults.find((error) => error !== undefined);
      if (failure !== undefined) throw failure;
    })();
    return this.#closePromise;
  }

  readonly handleRequest: NodeRequestHandler = async (request, response) => {
    if (await this.#handleFrameRequest(request, response)) return true;
    if (request.url === undefined) return false;

    const url = new URL(request.url, "http://vignette.local");
    if (url.pathname !== "/runtime") return false;

    const controller = new AbortController();
    response.once("close", () => {
      controller.abort();
    });
    void streamMessages(response, this.hub.subscribe(controller.signal), controller.signal).catch(
      (cause: unknown) => {
        this.#reportError(cause);
      },
    );
    return true;
  };

  override addEventListener(
    type: "error",
    listener: (event: ComposerErrorEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListener | EventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListener | EventListenerObject | ((event: ComposerErrorEvent) => void),
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type === "error") this.#hasErrorListener = true;
    super.addEventListener(type, listener as EventListener, options);
  }

  #reportError(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause), { cause });
    try {
      this.dispatchEvent(new ComposerErrorEvent(error));
    } catch {
      // An error listener must not turn an asynchronous failure into an unhandled rejection.
    }
    // Asynchronous failures must stay observable (invariant 5); never drop them silently.
    if (!this.#hasErrorListener) console.error(error);
  }

  #activate(connection: RuntimeConnection): void {
    if (connection.consumer !== undefined) return;
    connection.consumer = consumeRuntimeMessages(connection.runtime, this.hub.subscribe()).catch(
      (cause: unknown) => {
        this.#reportError(cause);
      },
    );
  }

  #isClosed(): boolean {
    return this.#closed;
  }
}

/** Creates a persistent composer host for HTTP and runtime integrations. */
export function createComposerHost(options: ComposerHostOptions): ComposerHost {
  return new ComposerHost(options);
}

function createUnconfiguredModuleHost(): ModuleHost {
  const fail = (): never => {
    throw new Error("Composer host has no frame module host configured (options.frames).");
  };
  return { resolveClientModule: fail, resolveClientHelper: fail };
}

async function streamMessages(
  response: ServerResponse,
  messages: AsyncIterable<RuntimeMessage>,
  signal: AbortSignal,
): Promise<void> {
  response.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });
  try {
    for await (const message of messages) {
      if (signal.aborted) return;
      response.write(encodeRuntimeMessageSse(message));
    }
  } finally {
    if (!response.writableEnded) response.end();
  }
}

async function settle(operation: Promise<void>): Promise<Error | undefined> {
  try {
    await operation;
    return undefined;
  } catch (cause) {
    return cause instanceof Error
      ? cause
      : new Error("Composer resource disposal failed.", { cause });
  }
}
