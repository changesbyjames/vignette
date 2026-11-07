import { QueryClientContext } from "@tanstack/react-query";
import {
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

import type { Snapshot } from "../core/snapshot.js";
import type { StreamMessage } from "../stream/messages.js";
import { revokeRemovedAssets } from "./assets.js";
import { createStreamClient } from "./client.js";
import { StreamContext, type StreamContextValue } from "./context.js";
import type { ReactSourcePlugin } from "./plugin.js";
import { SharedSourceView } from "./sources.js";
import { BrowserView } from "./sources/browser.js";
import { ColorView } from "./sources/color.js";
import { FrameView } from "./sources/frame.js";
import { ImageView } from "./sources/image.js";
import { TextView } from "./sources/text.js";
import { VideoView } from "./sources/video.js";

/** Props of {@link Stream}. */
export interface StreamProps {
  /** A server-sent events URL, followed with `fromSse` and reconnected on failure. */
  readonly url?: string;
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
  BrowserView,
  FrameView,
];

/**
 * Owns one connection to a show's stream and provides its snapshot, setup and status to
 * `<Stage>` and the hooks. Requires a TanStack `QueryClientProvider` above it, because assets
 * download as queries. `sources`, `builtins` and `checkPlugins` are read when the stream connects;
 * changing `url` or `source` reconnects.
 */
export function Stream({
  url,
  source,
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
  const latest = useRef({ plugins, checkPlugins });
  useEffect(() => {
    latest.current = { plugins, checkPlugins };
  });

  useEffect(() => {
    revokeRemovedAssets(queryClient);
  }, [queryClient]);
  useEffect(
    () =>
      client.connect(
        { url, source },
        {
          plugins: [...latest.current.plugins.values()],
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
