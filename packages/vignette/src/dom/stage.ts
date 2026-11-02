import type { Snapshot } from "../core/snapshot.js";

import { px } from "./styles.js";

/** A viewport that scales the show's canvas to fit its container without changing layout. */
export class DomStage {
  readonly viewport: HTMLDivElement;
  readonly stage: HTMLDivElement;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver | undefined;
  private width = 0;
  private height = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    const document = container.ownerDocument;
    this.viewport = document.createElement("div");
    this.stage = document.createElement("div");
    this.viewport.dataset.vignetteViewport = "";
    this.stage.dataset.vignetteStage = "";

    Object.assign(this.viewport.style, {
      position: "relative",
      overflow: "hidden",
      width: "100%",
      height: "100%",
    });
    Object.assign(this.stage.style, {
      position: "absolute",
      left: "0",
      top: "0",
      overflow: "hidden",
      isolation: "isolate",
      transformOrigin: "top left",
    });

    this.viewport.append(this.stage);
    container.replaceChildren(this.viewport);

    const ResizeObserverConstructor = container.ownerDocument.defaultView?.ResizeObserver;
    this.resizeObserver =
      ResizeObserverConstructor === undefined
        ? undefined
        : new ResizeObserverConstructor(() => {
            this.scaleToContainer();
          });
    this.resizeObserver?.observe(container);
  }

  /** Sizes the stage to the snapshot's canvas and rescales it to the container. */
  update(snapshot: Snapshot): void {
    this.width = snapshot.canvas.width;
    this.height = snapshot.canvas.height;
    this.stage.dataset.vignetteShow = snapshot.id;
    this.stage.dataset.vignetteRevision = String(snapshot.revision);
    Object.assign(this.stage.style, {
      width: px(this.width),
      height: px(this.height),
    });
    this.scaleToContainer();
  }

  /** Stops observing the container and empties it. */
  dispose(): void {
    this.resizeObserver?.disconnect();
    this.container.replaceChildren();
  }

  /** Fit the compiled canvas inside the measured container without changing its internal Yoga layout. */
  private scaleToContainer(): void {
    if (this.width <= 0 || this.height <= 0) return;
    const availableWidth = this.container.clientWidth;
    const availableHeight = this.container.clientHeight;
    const scale =
      availableWidth <= 0 || availableHeight <= 0
        ? 1
        : Math.min(availableWidth / this.width, availableHeight / this.height);
    this.stage.style.transform = scale === 1 ? "" : `scale(${String(scale)})`;
  }
}
