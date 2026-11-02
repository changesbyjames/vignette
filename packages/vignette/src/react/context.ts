import { createContext, useContext } from "react";

import type { Source } from "../core/snapshot.js";
import type { StreamClient } from "./client.js";
import type { ReactSourcePlugin } from "./plugin.js";

/** What `<Stream>` gives its descendants. */
export interface StreamContextValue {
  readonly client: StreamClient;
  readonly plugins: ReadonlyMap<string, ReactSourcePlugin>;
  /** The latest snapshot's sources by ID. */
  readonly sources: ReadonlyMap<string, Source>;
  /** Sources placed in more than one scene; they render once and move between stages. */
  readonly shared: ReadonlySet<string>;
}

export const StreamContext = createContext<StreamContextValue | undefined>(undefined);

/**
 * How often the source being rendered entered the shown scene: a shared source's slot entering a
 * stage box, an inline source's scene becoming the stage's shown scene.
 */
export const AppearanceContext = createContext(0);

/** The nearest `<Stream>`; throws a clear error outside one. */
export function useStreamContext(): StreamContextValue {
  const value = useContext(StreamContext);
  if (value === undefined) {
    throw new Error("vignette/react hooks and <Stage> must be rendered inside <Stream>.");
  }
  return value;
}
