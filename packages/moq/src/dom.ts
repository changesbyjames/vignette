/**
 * DOM renderer for Media over QUIC sources using `@moq/watch`.
 *
 * @module
 */
import type { DomSourceRenderer } from "@strangecyan/vignette-target-dom";

import { DEFAULT_MOQ_LATENCY_MS, MOQ_SOURCE_KIND, type MoqSource } from "./index.js";

interface MoqVideoTarget {
  readonly name?: string | undefined;
}

interface MoqWatchElementBackendVideoSourceTarget {
  update(update: (current: MoqVideoTarget | undefined) => MoqVideoTarget): void;
}

interface MoqWatchElementBackendVideoSource {
  readonly target: MoqWatchElementBackendVideoSourceTarget;
}

interface MoqWatchElementBackendVideo {
  readonly source: MoqWatchElementBackendVideoSource;
}

interface MoqWatchElementBackend {
  readonly video: MoqWatchElementBackendVideo;
}

interface MoqWatchElement extends HTMLElement {
  readonly backend?: MoqWatchElementBackend;
}

let elementRegistration: Promise<void> | undefined = undefined;

/** DOM facet: register with the DOM runtime or `useCompositor` (`extensions: [moqDomRenderer]`). */
export const moqDomRenderer: DomSourceRenderer<MoqSource> = {
  kind: MOQ_SOURCE_KIND,
  async prepare(document) {
    if (document.defaultView?.customElements.get("moq-watch") !== undefined) return;
    elementRegistration ??= import("@moq/watch/element").then(() => undefined);
    await elementRegistration;
  },
  retainWhenHidden(source) {
    return !(source.disableWhenHidden ?? true);
  },
  create(document) {
    // SAFETY: prepare registers the moq-watch custom element before create is called.
    const watch = document.createElement("moq-watch") as MoqWatchElement;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      display: "block",
      width: "100%",
      height: "100%",
    });
    watch.append(canvas);

    return {
      element: watch,
      update(source) {
        if (source.kind !== "source:moq") {
          throw new TypeError("MoQ renderer received another source kind.");
        }
        // SAFETY: The composer validates MoQ settings using the registered MoQ source module before publication.
        updateMoq(watch, source as MoqSource);
      },
      dispose() {
        watch.removeAttribute("url");
        watch.removeAttribute("name");
      },
    };
  },
};

/** Update the custom element from validated source settings, applying optional controls only when supplied. */
function updateMoq(watch: MoqWatchElement, source: MoqSource): void {
  watch.setAttribute("url", source.url);
  watch.setAttribute("name", source.broadcast);
  watch.setAttribute("latency", String(source.latencyMs ?? DEFAULT_MOQ_LATENCY_MS));
  watch.toggleAttribute("muted", !(source.audio ?? true));
  watch.setAttribute(
    "visible",
    source.video === false ? "never" : (source.disableWhenHidden ?? true) ? "0px" : "always",
  );

  const quality = source.quality ?? "auto";
  watch.dataset.vignetteMoqQuality = quality;
  watch.backend?.video.source.target.update((current) => ({
    ...current,
    name: quality === "auto" ? undefined : quality,
  }));
}
