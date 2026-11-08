import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";

import type { Source } from "../core/snapshot.js";
import { Frame } from "../core/sources/frame.js";
import type { StreamTransport } from "../stream/transport.js";
import type { FrameDefinition } from "./definition.js";
import { useSnapshot } from "../react/hooks.js";
import { Stream } from "../react/stream.js";

/** Options for {@link mountFrames}. */
export interface MountFramesOptions {
  /** Element to render into; defaults to `frames.html`'s `#frame`. */
  readonly root?: HTMLElement;
  /** The TanStack client `<Stream>` downloads assets with; defaults to a new one. */
  readonly queryClient?: QueryClient;
  /**
   * Transports for `?stream=` URL schemes beyond SSE (`http(s):`) and WebSocket (`ws(s):`); a
   * later one wins for a scheme. `bundle({ transports })` passes those its modules export.
   */
  readonly transports?: readonly StreamTransport[];
}

/**
 * The exports of one or more frame modules, keyed by export name. Values that are not frame
 * definitions are ignored.
 */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Spread module namespaces hold arbitrary exports; `mountFrames` keeps the frame definitions by shape.
export type FrameExports = Readonly<Record<string, unknown>>;

/** The members every `frame()` result has. */
const FrameDefinitionFieldsSchema = z.object({
  name: z.string().min(1),
  params: z.object({ parse: z.instanceof(Function) }),
  view: z.instanceof(Function),
});
type FrameDefinitionFields = z.output<typeof FrameDefinitionFieldsSchema>;

/**
 * An export that is a `frame()` result, whatever its params type. The check keeps the definition
 * itself rather than a parsed copy.
 */
const MountedFrameSchema = z.custom<FrameDefinition<object>>((value) => {
  const fields: z.ZodSafeParseResult<FrameDefinitionFields> =
    FrameDefinitionFieldsSchema.safeParse(value);
  return fields.success;
});
type MountedFrame = z.output<typeof MountedFrameSchema>;

/** Any value with the members of a `StreamTransport`: `protocols` and a `connect` function. */
const TransportExportSchema = z.custom<StreamTransport>(
  (value) =>
    z.object({ protocols: z.array(z.string()), connect: z.instanceof(Function) }).safeParse(value)
      .success,
);
type TransportExport = z.output<typeof TransportExportSchema>;

const ExportedListSchema = z.array(z.unknown());
type ExportedList = z.output<typeof ExportedListSchema>;

/** Fills the page (or the nearest positioned ancestor of a custom root). */
const FILL: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
};

const ERROR_STYLE: CSSProperties = {
  margin: 16,
  color: "#ff5c5c",
  font: "16px/1.4 ui-monospace, monospace",
  whiteSpace: "pre-wrap",
};

/**
 * Mounts the frame page: renders the frame named by `?frame=` for the source `?source=` of the
 * stream at `?stream=`, read with the transport for its scheme, re-rendering in place whenever that source's params change. `frames` is
 * any object whose values include frame definitions, such as spread module namespaces; other
 * values are ignored. Two frames with one name are an error. Returns a function that unmounts.
 */
export function mountFrames(frames: FrameExports, options: MountFramesOptions = {}): () => void {
  const definitions = frameDefinitions(frames);
  const element = options.root ?? document.getElementById("frame");
  if (element === null) throw new Error("mountFrames: the page has no #frame element.");
  const query = new URLSearchParams(element.ownerDocument.defaultView?.location.search ?? "");
  const root = createRoot(element);
  root.render(
    framePage(query, definitions, {
      queryClient: () => options.queryClient ?? new QueryClient(),
      transports: options.transports ?? [],
    }),
  );
  return () => {
    root.unmount();
  };
}

/**
 * The stream transports among the exports of each module, directly or inside an exported array,
 * for {@link MountFramesOptions.transports}; other exports are ignored. A module that exports
 * none is an error, as it is surely the wrong module.
 */
export function streamTransports(...modules: readonly FrameExports[]): readonly StreamTransport[] {
  return modules.flatMap((exports, index) => {
    const found = Object.values(exports)
      .flatMap((value): ExportedList => {
        const list = ExportedListSchema.safeParse(value);
        return list.success ? list.data : [value];
      })
      .flatMap((value): readonly TransportExport[] => {
        const transport = TransportExportSchema.safeParse(value);
        return transport.success ? [transport.data] : [];
      });
    if (found.length === 0) {
      throw new Error(
        `mountFrames: transport module ${String(index + 1)} exports no stream transports (objects with protocols and connect).`,
      );
    }
    return found;
  });
}

/** What the frame page needs besides its query and frames. */
interface FramePageContext {
  readonly queryClient: () => QueryClient;
  readonly transports: readonly StreamTransport[];
}

/**
 * The page for `?frame=&source=&stream=`: the frame following its source in the stream, or an
 * error when a parameter is missing or the frame is not among `definitions`.
 */
function framePage(
  query: URLSearchParams,
  definitions: readonly MountedFrame[],
  { queryClient, transports }: FramePageContext,
): ReactNode {
  const frame = query.get("frame");
  const source = query.get("source");
  const stream = query.get("stream");
  if (frame === null || source === null || stream === null) {
    return <FrameError message="frames.html needs ?frame=, ?source= and ?stream=." />;
  }
  const definition = definitions.find((candidate) => candidate.name === frame);
  if (definition === undefined) {
    return <FrameError message={`Frame "${frame}" is not in this bundle.`} />;
  }
  return (
    <QueryClientProvider client={queryClient()}>
      {/* The page renders its one source itself, so kinds without a React plugin are fine. */}
      <Stream url={stream} transports={transports} checkPlugins={false}>
        <FrameFromSource key={source} source={source} definition={definition} />
      </Stream>
    </QueryClientProvider>
  );
}

/** The frame definitions among `exports`; throws when two share a name. */
function frameDefinitions(exports: FrameExports): readonly MountedFrame[] {
  const byName = new Map<string, MountedFrame>();
  for (const value of new Set(Object.values(exports))) {
    const checked = MountedFrameSchema.safeParse(value);
    if (!checked.success) continue;
    if (byName.has(checked.data.name)) {
      throw new Error(`mountFrames: two frames are named "${checked.data.name}".`);
    }
    byName.set(checked.data.name, checked.data);
  }
  return [...byName.values()];
}

/** Props of {@link FrameFromSource}. */
interface FrameFromSourceProps {
  readonly source: string;
  readonly definition: MountedFrame;
}

/** The source is not in the snapshot (yet), or it is not this frame: render nothing. */
interface AbsentFrame {
  readonly kind: "absent";
}

/** The frame's schema rejected the source's params. */
interface InvalidFrame {
  readonly kind: "invalid";
  readonly message: string;
}

/** The params the frame's view renders with. */
interface ReadyFrame {
  readonly kind: "ready";
  readonly params: object;
}

/** What the page shows for its source. */
type FrameState = AbsentFrame | InvalidFrame | ReadyFrame;

/**
 * Renders `definition` with the params of source `source` from the latest snapshot. Renders
 * nothing while connecting, while the source is absent, or when it is not this frame.
 */
function FrameFromSource({ source, definition }: FrameFromSourceProps): ReactNode {
  const snapshot = useSnapshot();
  const props = snapshot?.sources.find(
    (entry) => entry.id === source && entry.kind === "frame",
  )?.props;
  const state = useMemo(() => frameState(props, definition), [props, definition]);
  if (state.kind === "absent") return null;
  if (state.kind === "invalid") return <FrameError message={state.message} />;
  const View = definition.view;
  return (
    <div style={FILL}>
      <View {...state.params} />
    </div>
  );
}

/** Absent unless the source is this frame; then its params as the frame's schema parses them. */
function frameState(props: Source["props"] | undefined, definition: MountedFrame): FrameState {
  const checked = Frame.definition.props.safeParse(props);
  if (!checked.success || checked.data.frame !== definition.name) return { kind: "absent" };
  try {
    // Snapshot params are JSON; the frame's schema decides whether they are valid.
    return { kind: "ready", params: definition.params.parse(checked.data.params) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      kind: "invalid",
      message: `Invalid params for frame "${definition.name}": ${message}`,
    };
  }
}

/** Props of {@link FrameError}. */
interface FrameErrorProps {
  readonly message: string;
}

function FrameError({ message }: FrameErrorProps): ReactNode {
  return (
    <pre role="alert" style={ERROR_STYLE}>
      {message}
    </pre>
  );
}
