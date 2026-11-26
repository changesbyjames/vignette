import { QueryClientContext } from "@tanstack/react-query";
import {
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import type { Item, Snapshot } from "../core/snapshot.js";
import type { StreamMessage } from "../stream/messages.js";
import type { StreamTransport } from "../stream/transport.js";
import { revokeRemovedAssets } from "./assets.js";
import { createStreamClient } from "./client.js";
import {
  AppearanceContext,
  StreamContext,
  useStreamContext,
  type StreamContextValue,
} from "./context.js";
import type { ReactSourcePlugin } from "./plugin.js";
import { SharedSourceView, SourceView } from "./sources.js";
import { AudioView } from "./sources/audio.js";
import { BrowserView } from "./sources/browser.js";
import { ColorView } from "./sources/color.js";
import { FrameView } from "./sources/frame.js";
import { ImageView } from "./sources/image.js";
import { TextView } from "./sources/text.js";
import { VideoView } from "./sources/video.js";

/** Props of {@link Stream}. */
export interface StreamProps {
  /**
   * The stream's URL, followed by the transport for its scheme (SSE for `http(s):`, WebSocket for
   * `ws(s):`, or one of `transports`) and reconnected on failure.
   */
  readonly url?: string;
  /** Transports for `url` schemes beyond SSE and WebSocket; a later one wins for a scheme. */
  readonly transports?: readonly StreamTransport[];
  /** Any other wire, e.g. `composer.stream()` in the same page. Takes precedence over `url`. */
  readonly source?: AsyncIterable<StreamMessage>;
  /** Plugins for source kinds; later entries win per kind, including over the built-ins. */
  readonly sources?: readonly ReactSourcePlugin[];
  /** Registers the built-in color, image, video, browser, frame and text views. Default `true`. */
  readonly builtins?: boolean;
  /**
   * Fail a revision that uses a kind without a plugin: the stage keeps the last revision it
   * rendered and `useStreamStatus().error` names the kind. Default `true`. With `false`, a
   * source of such a kind renders an empty box and shows as `error` in `useStreamStatus().sources`,
   * and the rest of the scene renders; for pages that show any show, such as previews.
   */
  readonly checkPlugins?: boolean;
  readonly children?: ReactNode;
}

/** The built-in views, registered unless `builtins: false`. */
const BUILTIN_PLUGINS: readonly ReactSourcePlugin[] = [
  ColorView,
  ImageView,
  TextView,
  VideoView,
  AudioView,
  BrowserView,
  FrameView,
];

/**
 * Owns one connection to a show's stream and provides its snapshot, setup and status to
 * `<Stage>` and the hooks. Requires a TanStack `QueryClientProvider` above it, because assets
 * download as queries. `sources`, `transports`, `builtins` and `checkPlugins` are read when the stream
 * connects;
 * changing `url` or `source` reconnects.
 */
export function Stream({
  url,
  source,
  transports,
  sources,
  builtins = true,
  checkPlugins = true,
  children,
}: StreamProps): ReactNode {
  const queryClient = useContext(QueryClientContext);
  if (queryClient === undefined) {
    throw new Error(
      "<Stream> needs a TanStack QueryClientProvider above it: assets download as queries.",
    );
  }
  const [client] = useState(createStreamClient);
  const plugins = useMemo(
    () =>
      new Map([...(builtins ? BUILTIN_PLUGINS : []), ...(sources ?? [])].map((p) => [p.kind, p])),
    [builtins, sources],
  );
  const latest = useRef({ plugins, transports, checkPlugins });
  useEffect(() => {
    latest.current = { plugins, transports, checkPlugins };
  });

  useEffect(() => {
    revokeRemovedAssets(queryClient);
  }, [queryClient]);
  useEffect(
    () => () => {
      client.media.dispose();
    },
    [client],
  );
  useEffect(
    () =>
      client.connect(
        { url, source },
        {
          plugins: [...latest.current.plugins.values()],
          transports: latest.current.transports,
          checkPlugins: latest.current.checkPlugins,
        },
      ),
    [client, url, source],
  );

  const read = () => client.state.snapshot;
  const snapshot = useSyncExternalStore(client.subscribe, read, read);
  const sourceMap = useMemo(
    () => new Map((snapshot?.sources ?? []).map((entry) => [entry.id, entry])),
    [snapshot],
  );
  const shared = useMemo(() => sharedSources(snapshot), [snapshot]);
  const pictureless = useMemo(() => picturelessSources(snapshot), [snapshot]);
  useLayoutEffect(() => {
    client.shared.retain(shared);
  }, [client, shared]);

  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      client.shared.attach(element);
      setHost(element);
    },
    [client],
  );

  const value: StreamContextValue = useMemo(
    () => ({ client, plugins, sources: sourceMap, shared }),
    [client, plugins, sourceMap, shared],
  );
  return (
    <StreamContext value={value}>
      {children}
      <div ref={attach} aria-hidden data-vignette-shared-host="" style={HOST_STYLE} />
      <div aria-hidden data-vignette-pictureless-host="" style={HOST_STYLE}>
        {pictureless.map((id) => (
          <PicturelessView key={id} id={id} />
        ))}
      </div>
      {host === null
        ? null
        : [...shared].map((id) =>
            createPortal(
              <SharedSourceView id={id} />,
              client.shared.slot(id, host.ownerDocument),
              id,
            ),
          )}
    </StreamContext>
  );
}

/**
 * Where shared sources wait while no stage shows them: laid out but invisible, so a page keeps
 * running and a video keeps playing.
 */
const HOST_STYLE: CSSProperties = {
  position: "absolute",
  width: 0,
  height: 0,
  overflow: "hidden",
  visibility: "hidden",
  pointerEvents: "none",
};

/** Sources with no picture that some scene places, each once. */
function picturelessSources(snapshot: Snapshot | undefined): readonly string[] {
  return [...new Set(snapshot?.scenes.flatMap((scene) => scene.audio ?? []))];
}

/** Props of {@link PicturelessView}. */
interface PicturelessViewProps {
  readonly id: string;
}

/**
 * A source with no picture, rendered once for the stream's life whatever stage shows its scene;
 * its appearances count the times a stage started hearing it, for `restartOnShow`.
 */
function PicturelessView({ id }: PicturelessViewProps): ReactNode {
  const { client, sources } = useStreamContext();
  const read = () => client.media.appearances(id);
  const appearances = useSyncExternalStore(
    (listener) => client.media.subscribe(listener),
    read,
    read,
  );
  const source = sources.get(id);
  if (source === undefined) return null;
  return (
    <AppearanceContext value={appearances}>
      <Suspense fallback={null}>
        <SourceView source={source} item={picturelessItem(id)} />
      </Suspense>
    </AppearanceContext>
  );
}

/** The item a pictureless source's view gets: nothing to lay out. */
function picturelessItem(sourceId: string): Item {
  const none = { x: 0, y: 0, width: 0, height: 0 };
  return {
    id: sourceId,
    sourceId,
    frame: none,
    placement: {
      destination: none,
      sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    visible: false,
    opacity: 1,
    rotation: 0,
  };
}

/** Sources placed in more than one scene. */
function sharedSources(snapshot: Snapshot | undefined): ReadonlySet<string> {
  const scenesBySource = new Map<string, Set<string>>();
  for (const scene of snapshot?.scenes ?? []) {
    for (const item of scene.items) {
      const scenes = scenesBySource.get(item.sourceId) ?? new Set<string>();
      scenes.add(scene.id);
      scenesBySource.set(item.sourceId, scenes);
    }
  }
  return new Set([...scenesBySource].flatMap(([id, scenes]) => (scenes.size > 1 ? [id] : [])));
}
