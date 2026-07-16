import type { CompiledItem, CompiledSource, SourceDefinition, SourceId } from "@cbj/react-obs-core";

import type { DomRendererMap, DomSourceView } from "./elements/index.js";

interface SourceRecord {
  readonly kind: SourceDefinition["kind"];
  readonly view: DomSourceView;
  retainWhenInactive: boolean;
}

export class DomSourceRegistry {
  readonly #document: Document;
  readonly #renderers: DomRendererMap;
  readonly #parking: HTMLDivElement;
  readonly #records = new Map<SourceId, SourceRecord>();

  constructor(container: HTMLElement, renderers: DomRendererMap) {
    this.#document = container.ownerDocument;
    this.#renderers = renderers;
    this.#parking = this.#document.createElement("div");
    this.#parking.dataset.reactObsSourceParking = "";
    this.#parking.hidden = true;
    this.#parking.style.display = "none";
    container.append(this.#parking);
  }

  reconcile(sources: readonly CompiledSource[]): void {
    const desired = new Map(sources.map((source) => [source.id, source.definition.kind]));
    for (const [id, record] of this.#records) {
      if (desired.get(id) === record.kind) continue;
      this.disposeRecord(id, record);
    }
  }

  mount(
    host: HTMLElement,
    source: SourceDefinition,
    item: CompiledItem,
    resolvedUrl: string | undefined,
  ): DomSourceView {
    let record = this.#records.get(source.id);
    if (record?.kind !== source.kind) {
      if (record !== undefined) this.disposeRecord(source.id, record);
      record = {
        kind: source.kind,
        view: this.createView(source),
        retainWhenInactive: this.shouldRetain(source),
      };
      this.#records.set(source.id, record);
    }
    record.retainWhenInactive = this.shouldRetain(source);

    const element = record.view.element;
    if (element.parentNode !== host) moveElement(host, element);
    record.view.update(source, item, resolvedUrl);
    element.dataset.reactObsSource = source.id;
    return record.view;
  }

  releaseFrom(host: HTMLElement): boolean {
    const located = this.locateIn(host);
    if (located === undefined) return true;
    if (!located.record.retainWhenInactive) {
      this.disposeRecord(located.id, located.record);
      return true;
    }
    if (!canMovePreservingState(this.#parking, located.record.view.element)) return false;
    this.#parking.moveBefore(located.record.view.element, null);
    return true;
  }

  disposeFrom(host: HTMLElement): void {
    const located = this.locateIn(host);
    if (located === undefined) return;
    this.disposeRecord(located.id, located.record);
  }

  dispose(): void {
    for (const [id, record] of this.#records) this.disposeRecord(id, record);
    this.#parking.remove();
  }

  private createView(source: SourceDefinition): DomSourceView {
    const renderer = this.#renderers.get(source.kind);
    if (renderer === undefined) {
      throw new Error(`No DOM renderer is registered for source kind '${source.kind}'.`);
    }
    return renderer.create(this.#document);
  }

  private shouldRetain(source: SourceDefinition): boolean {
    return this.#renderers.get(source.kind)?.retainWhenHidden?.(source) ?? true;
  }

  private locateIn(
    host: HTMLElement,
  ): Readonly<{ id: SourceId; record: SourceRecord }> | undefined {
    for (const [id, record] of this.#records) {
      if (record.view.element.parentNode === host) return { id, record };
    }
    return undefined;
  }

  private disposeRecord(id: SourceId, record: SourceRecord): void {
    record.view.dispose();
    record.view.element.remove();
    this.#records.delete(id);
  }
}

function canMovePreservingState(parent: HTMLElement, element: HTMLElement): boolean {
  return element.isConnected && parent.isConnected && typeof parent.moveBefore === "function";
}

function moveElement(parent: HTMLElement, element: HTMLElement): void {
  if (canMovePreservingState(parent, element)) {
    parent.moveBefore(element, null);
  } else {
    parent.append(element);
  }
}
