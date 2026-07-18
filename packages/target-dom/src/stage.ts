import type { CompiledSnapshot } from "@strangecyan/vignette-core";

import { px } from "./styles.js";

export class DomStage {
  readonly viewport: HTMLDivElement;
  readonly stage: HTMLDivElement;

  readonly #container: HTMLElement;
  readonly #resizeObserver: ResizeObserver | undefined;
  #width = 0;
  #height = 0;

  constructor(container: HTMLElement) {
    this.#container = container;
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
    this.#resizeObserver =
      ResizeObserverConstructor === undefined
        ? undefined
        : new ResizeObserverConstructor(() => {
            this.scaleToContainer();
          });
    this.#resizeObserver?.observe(container);
  }

  update(snapshot: CompiledSnapshot): void {
    this.#width = snapshot.canvas.width;
    this.#height = snapshot.canvas.height;
    this.stage.dataset.vignetteProject = snapshot.projectId;
    this.stage.dataset.vignetteRevision = String(snapshot.revision);
    Object.assign(this.stage.style, {
      width: px(this.#width),
      height: px(this.#height),
    });
    this.scaleToContainer();
  }

  dispose(): void {
    this.#resizeObserver?.disconnect();
    this.#container.replaceChildren();
  }

  private scaleToContainer(): void {
    if (this.#width <= 0 || this.#height <= 0) return;
    const availableWidth = this.#container.clientWidth;
    const availableHeight = this.#container.clientHeight;
    const scale =
      availableWidth <= 0 || availableHeight <= 0
        ? 1
        : Math.min(availableWidth / this.#width, availableHeight / this.#height);
    this.stage.style.transform = scale === 1 ? "" : `scale(${String(scale)})`;
  }
}
