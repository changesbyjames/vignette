import { deepFreeze } from "../core/objects.js";
import type { Snapshot } from "../core/snapshot.js";
import type { StreamMessage } from "./messages.js";

/** How a host narrows a stream it serves. */
export interface StreamOptions {
  /**
   * Serve one source, as a frame page needs: setup, then a snapshot holding only that source,
   * sent when the source changes or goes, and the show events for it or for no source.
   */
  readonly source?: string;
}

/** The query parameter a frame page's stream URL names its source with. */
export const STREAM_SOURCE_PARAM = "source";

/**
 * The options a stream request asks for, from its URL: `?source=` narrows it to one source. A
 * host passes them to `composer.stream(signal, streamOptions(request.url))`.
 */
export function streamOptions(url: string | URL): StreamOptions {
  const source = new URL(url, "http://localhost").searchParams.get(STREAM_SOURCE_PARAM);
  return source === null || source === "" ? {} : { source };
}

/**
 * `messages` narrowed to one source. Every frame page follows the stream for its own params, and
 * the whole snapshot every revision costs each page parsing and memory for sources it never
 * shows; this sends a page only what it renders, and only when that changed.
 */
export async function* sourceStream(
  messages: AsyncIterable<StreamMessage>,
  source: string,
): AsyncIterable<StreamMessage> {
  // The last source sent, as JSON; `undefined` until one is sent, "" once it was sent as absent.
  let sent: string | undefined = undefined;
  for await (const message of messages) {
    // Setup always passes and resets what was sent; events pass for this source or none; an update
    // passes, narrowed, only when this source differs from what was sent last.
    if (message.kind === "setup") {
      sent = undefined;
      yield message;
    } else if (message.kind === "event") {
      const target = message.event.sourceId;
      if (target === undefined || target === source) yield message;
    } else {
      const own = message.snapshot.sources.find((candidate) => candidate.id === source);
      const key = own === undefined ? "" : JSON.stringify(own);
      if (key === sent) continue;
      sent = key;
      yield { kind: "update", snapshot: narrowed(message.snapshot, own) };
    }
  }
}

/** The snapshot with only `own` among its sources, and no scenes, which a frame page never reads. */
function narrowed(snapshot: Snapshot, own: Snapshot["sources"][number] | undefined): Snapshot {
  // Snapshots cross into targets frozen.
  return deepFreeze({
    revision: snapshot.revision,
    id: snapshot.id,
    canvas: snapshot.canvas,
    sources: own === undefined ? [] : [own],
    scenes: [],
  });
}
