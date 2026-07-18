/**
 * DOM renderer for Media over QUIC sources using `@moq/watch`.
 *
 * @module
 */
import type { DomSourceRenderer } from "@strangecyan/vignette-target-dom";

import { DEFAULT_MOQ_LATENCY_MS, type MoqSource } from "./index.js";

interface MoqWatchElement extends HTMLElement {
  readonly backend?: {
    readonly video: {
      readonly source: {
        readonly target: {
          update(update: (current: Readonly<Record<string, unknown>> | undefined) => object): void;
        };
      };
    };
  };
}

let elementRegistration: Promise<void> | undefined;

/** DOM facet: register with the DOM runtime (`extensions: [moqDomRenderer]`). */
export const moqDomRenderer: DomSourceRenderer<MoqSource> = {
  kind: "source:moq",
  async prepare(document) {
    if (document.defaultView?.customElements.get("moq-watch") !== undefined) return;
    elementRegistration ??= import("@moq/watch/element").then(() => undefined);
    await elementRegistration;
  },
  retainWhenHidden(source) {
    return !(source.disableWhenHidden ?? true);
  },
  create(document) {
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
        updateMoq(watch, source as unknown as MoqSource);
      },
      dispose() {
        watch.removeAttribute("url");
        watch.removeAttribute("name");
      },
    };
  },
};

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
