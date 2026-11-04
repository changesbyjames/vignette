import type { z } from "zod";

import type { HasSourceDefinition, SourcePropsSchemaType } from "../core/define-source.js";
import type { Canvas, Source } from "../core/snapshot.js";
import type { SetupMessage } from "../stream/messages.js";
import { STREAM_SOURCE_PARAM } from "../stream/source-stream.js";

/** What every target's source plugin has: the kind it renders. */
export interface SourcePluginBase {
  readonly kind: string;
}

/** A snapshot source whose props are typed by its kind's schema. */
export interface TypedSource<Props> extends Omit<Source, "props"> {
  readonly props: Props;
}

/**
 * The source a plugin for `Def` receives, e.g. `SourceOf<typeof Moq>`: props typed by the kind's
 * schema output. Without a definition, a plain {@link Source}.
 */
export type SourceOf<Def> =
  Def extends HasSourceDefinition<infer Schema extends SourcePropsSchemaType>
    ? TypedSource<z.output<Schema>>
    : Source;

/** Downloaded assets, resolved by name to something the medium can load. */
export interface PluginAssets<Resolved = string> {
  /** Resolves once the asset is downloaded and verified: an object URL (DOM) or file path (OBS). */
  resolve(name: string): Promise<Resolved>;
}

/** What every target gives its plugins. Targets extend it with medium-specific members. */
export interface PluginContextBase<Resolved = string> {
  /** The show's canvas. */
  readonly canvas: Canvas;
  /** Aborts when the target is disposed. */
  readonly signal: AbortSignal;
  readonly assets: PluginAssets<Resolved>;
  /**
   * The page URL of a frame source: `serve.frames?frame=…&source=…&stream=…`, from the setup,
   * whose stream is `serve.stream?source=…`, narrowed to the source. Throws when the setup does
   * not publish `serve.frames` and `serve.stream`.
   */
  readonly frames: (frame: string, sourceId: string) => string;
}

/**
 * `serve.frames?frame=…&source=…&stream=…`. The page's stream asks for its one source with
 * `?source=`; a host that serves the whole stream regardless still works.
 */
export function frameUrl(setup: SetupMessage, frame: string, sourceId: string): string {
  const { frames, stream } = setup.serve;
  if (frames === undefined || stream === undefined) {
    throw new Error(
      `MISSING_SERVE: frame "${frame}" needs serve.frames and serve.stream in the setup.`,
    );
  }
  const url = new URL(frames);
  url.searchParams.set("frame", frame);
  url.searchParams.set("source", sourceId);
  const own = new URL(stream);
  own.searchParams.set(STREAM_SOURCE_PARAM, sourceId);
  url.searchParams.set("stream", own.href);
  return url.href;
}
