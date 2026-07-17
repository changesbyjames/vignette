import {
  createContext,
  createElement,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

/** Reactive values used while deriving target-visible scene resources. */
export interface SceneState {
  readonly origin: string;
}

/** Synchronous external store for platform-owned scene plumbing. */
export interface SceneStore {
  readonly get: () => SceneState;
  readonly set: (partial: Partial<SceneState>) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export const SceneContext = createContext<SceneState | undefined>(undefined);

/** Creates reactive platform plumbing used while composing frame URLs. */
export function createSceneStore(config: SceneState): SceneStore {
  let state: SceneState = Object.freeze({ origin: normalizeOrigin(config.origin) });
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (partial) => {
      const next = Object.freeze({ origin: normalizeOrigin(partial.origin ?? state.origin) });
      if (next.origin === state.origin) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Props for the reactive scene plumbing provider. */
export interface SceneProviderProps {
  readonly scene: SceneStore;
  readonly children?: ReactNode;
}

/** Makes reactive scene plumbing available to frame views. */
export function SceneProvider(props: SceneProviderProps): ReactElement {
  const state = useSyncExternalStore(props.scene.subscribe, props.scene.get, props.scene.get);
  return createElement(SceneContext.Provider, { value: state, children: props.children });
}

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Frame origin must use HTTP(S).");
  }
  if (parsed.pathname !== "/" || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new TypeError("Frame origin must not contain a path, query, or fragment.");
  }
  return parsed.origin;
}
