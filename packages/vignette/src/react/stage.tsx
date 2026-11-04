import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import type { Canvas, Item, SnapshotScene } from "../core/snapshot.js";
import { AppearanceContext, useStreamContext } from "./context.js";
import { useScene, useSnapshot } from "./hooks.js";
import { canvasStyle, contentStyle, fitScale, itemStyle } from "./placement.js";
import { SourceView } from "./sources.js";

/** Props of {@link Stage}. */
export interface StageProps {
  /** The scene to show. Defaults to the snapshot's `activeScene`, then its first scene. */
  readonly scene?: string;
  readonly className?: string;
  /** Merged over the stage's defaults: relative positioning and the canvas aspect ratio. */
  readonly style?: CSSProperties;
}

/**
 * Renders one scene of the stream as positioned elements from the compiled Yoga frames, scaled
 * to fit the stage's own box. A plain component: style it, wrap it, or render several under one
 * `<Stream>`. Image and video sources suspend while their assets download.
 *
 * A stage following the active scene renders every scene and hides all but the shown one, so an
 * inline source stays mounted for as long as its layer exists, as in the DOM and OBS targets: a
 * scene switch neither reloads its page nor restarts its video.
 */
export function Stage({ scene, className, style }: StageProps): ReactNode {
  const snapshot = useSnapshot();
  const shown = useScene(scene);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = snapshot?.canvas;
  const scale = useFitScale(viewport, canvas);
  const aspectRatio =
    canvas === undefined ? undefined : `${String(canvas.width)} / ${String(canvas.height)}`;
  const scenes = scene === undefined ? snapshot?.scenes : shown === undefined ? [] : [shown];
  return (
    <div
      ref={viewport}
      className={className}
      data-vignette-stage={shown?.id}
      style={{ position: "relative", overflow: "hidden", aspectRatio, ...style }}
    >
      {canvas === undefined ? null : (
        <div style={canvasStyle(canvas, scale)}>
          {scenes?.map((entry) => (
            <SceneBox key={entry.id} scene={entry} shown={entry.id === shown?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Watches the viewport's size and returns the scale that fits the canvas inside it. */
function useFitScale(
  viewport: RefObject<HTMLDivElement | null>,
  canvas: Canvas | undefined,
): number {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    // Without a ResizeObserver (server, jsdom) the canvas stays at scale 1.
    const element = viewport.current;
    const Observer = element?.ownerDocument.defaultView?.ResizeObserver;
    if (element === null || Observer === undefined) return undefined;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    const observer = new Observer(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [viewport]);
  return canvas === undefined ? 1 : fitScale(canvas, size.width, size.height);
}

/** Props of {@link SceneBox}. */
interface SceneBoxProps {
  readonly scene: SnapshotScene;
  readonly shown: boolean;
}

/** One scene's items; hidden, but mounted and running, while another scene is shown. */
function SceneBox({ scene, shown }: SceneBoxProps): ReactNode {
  const appearances = useAppearances(shown);
  const { layers } = useStreamContext();
  // A layer plugin's `Presence` keeps removed items mounted while they exit.
  const Presence = [...layers.values()].find((plugin) => plugin.Presence)?.Presence ?? Fragment;
  return (
    <div data-vignette-scene={scene.id} style={shown ? SCENE_STYLE : HIDDEN_SCENE_STYLE}>
      <AppearanceContext value={appearances}>
        <Presence>
          {scene.items.map((item, order) => (
            <ItemBox key={item.id} item={item} order={order} shown={shown} />
          ))}
        </Presence>
      </AppearanceContext>
    </div>
  );
}

const SCENE_STYLE: CSSProperties = { position: "absolute", inset: 0, zIndex: 1 };
const HIDDEN_SCENE_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  visibility: "hidden",
  pointerEvents: "none",
};

/** Counts how often `shown` turned true, starting at 1 for a scene mounted shown. */
function useAppearances(shown: boolean): number {
  const [state, setState] = useState({ shown, count: shown ? 1 : 0 });
  if (state.shown === shown) return state.count;
  const next = { shown, count: state.count + (shown ? 1 : 0) };
  setState(next);
  return next.count;
}

/** Props of {@link ItemBox}. */
interface ItemBoxProps {
  readonly item: Item;
  readonly order: number;
  readonly shown: boolean;
}

/**
 * One item: its frame, then its fitted content box, then the source. A shared source's box
 * claims the source only while its scene is shown.
 */
function ItemBox({ item, order, shown }: ItemBoxProps): ReactNode {
  const { shared, sources, layers } = useStreamContext();
  const source = sources.get(item.sourceId);
  const content = shared.has(item.sourceId) ? (
    shown ? (
      <SharedBox item={item} />
    ) : null
  ) : (
    <div style={contentStyle(item)}>
      {source === undefined ? null : <SourceView source={source} item={item} />}
    </div>
  );
  // An item of a layer kind is placed by the kind's plugin; a plain layer by the stage.
  const Place = layers.get(item.kind)?.Place;
  if (Place !== undefined) {
    return (
      <Place item={item} order={order}>
        {content}
      </Place>
    );
  }
  return (
    <div data-vignette-layer={item.id} style={itemStyle(item, order)}>
      {content}
    </div>
  );
}

/** Props of {@link SharedBox}. */
interface SharedBoxProps {
  readonly item: Item;
}

/**
 * The content box of an item placing a shared source. The source's view is rendered once by
 * `<Stream>`; this box claims its element while mounted. Layout effects matter: their cleanup
 * runs before React removes the box, so the element moves out while still connected.
 */
function SharedBox({ item }: SharedBoxProps): ReactNode {
  const { client } = useStreamContext();
  const box = useRef<HTMLDivElement>(null);
  const placed = useRef(item);
  const { sourceId } = item;
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    client.shared.claim(sourceId, element, placed.current);
    return () => {
      client.shared.release(sourceId, element);
    };
  }, [client, sourceId]);
  useLayoutEffect(() => {
    placed.current = item;
    if (box.current !== null) client.shared.place(sourceId, box.current, item);
  }, [client, sourceId, item]);
  return <div ref={box} style={contentStyle(item)} />;
}
