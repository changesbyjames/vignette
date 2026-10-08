import type { AnySourceDefinition, CompiledItem, CompiledSource } from "@strangecyan/vignette-core";

import type { DomRendererContext, DomRendererMap, DomSourceView } from "./elements/index.js";

interface DomSourceRegistryLocateIn {
  id: string;
  record: SourceRecord;
}

interface SourceRecord {
  readonly kind: AnySourceDefinition["kind"];
  readonly view: DomSourceView;
  active: boolean;
  retainWhenInactive: boolean;
}

export class DomSourceRegistry {
  private readonly document: Document;
  private readonly renderers: DomRendererMap;
  private readonly context: DomRendererContext;
  private readonly parking: HTMLDivElement;
  private readonly records = new Map<string, SourceRecord>();

  constructor(container: HTMLElement, renderers: DomRendererMap, context: DomRendererContext) {
    this.document = container.ownerDocument;
    this.renderers = renderers;
    this.context = context;
    this.parking = this.document.createElement("div");
    this.parking.dataset.vignetteSourceParking = "";
    this.parking.hidden = true;
    this.parking.style.display = "none";
    container.append(this.parking);
  }

  reconcile(sources: readonly CompiledSource[]): void {
    const desired = new Map(sources.map((source) => [source.id, source.definition.kind]));
    for (const [id, record] of this.records) {
      if (desired.get(id) === record.kind) continue;
      this.disposeRecord(id, record);
    }
  }

  /** Reuse compatible source views while tracking host ownership, and replace views when their module changes. */
  mount(
    host: HTMLElement,
    source: AnySourceDefinition,
    item: CompiledItem,
    resolvedUrl: string | undefined,
  ): DomSourceView {
    let record = this.records.get(source.id);
    if (record?.kind !== source.kind) {
      if (record !== undefined) this.disposeRecord(source.id, record);
      record = {
        kind: source.kind,
        view: this.createView(source),
        active: false,
        retainWhenInactive: this.shouldRetain(source),
      };
      this.records.set(source.id, record);
    }
    record.retainWhenInactive = this.shouldRetain(source);

    const element = record.view.element;
    const activating = !record.active || element.parentNode !== host;
    if (element.parentNode !== host) moveElement(host, element);
    record.view.update(source, item, resolvedUrl);
    if (activating) record.view.activate?.();
    record.active = true;
    element.dataset.vignetteSource = source.id;
    return record.view;
  }

  releaseFrom(host: HTMLElement): boolean {
    const located = this.locateIn(host);
    if (located === undefined) return true;
    located.record.active = false;
    if (!located.record.retainWhenInactive) {
      this.disposeRecord(located.id, located.record);
      return true;
    }
    if (!canMovePreservingState(this.parking, located.record.view.element)) return false;
    this.parking.moveBefore(located.record.view.element, null);
    return true;
  }

  disposeFrom(host: HTMLElement): void {
    const located = this.locateIn(host);
    if (located === undefined) return;
    this.disposeRecord(located.id, located.record);
  }

  dispose(): void {
    for (const [id, record] of this.records) this.disposeRecord(id, record);
    this.parking.remove();
  }

  private createView(source: AnySourceDefinition): DomSourceView {
    const renderer = this.renderers.get(source.kind);
    if (renderer === undefined) {
      throw new Error(`No DOM renderer is registered for source kind '${source.kind}'.`);
    }
    return renderer.create(this.document, this.context);
  }

  private shouldRetain(source: AnySourceDefinition): boolean {
    return this.renderers.get(source.kind)?.retainWhenHidden?.(source) ?? true;
  }

  private locateIn(host: HTMLElement): Readonly<DomSourceRegistryLocateIn> | undefined {
    for (const [id, record] of this.records) {
      if (record.view.element.parentNode === host) return { id, record };
    }
    return undefined;
  }

  private disposeRecord(id: string, record: SourceRecord): void {
    record.view.dispose();
    record.view.element.remove();
    this.records.delete(id);
  }
}

function canMovePreservingState(parent: HTMLElement, element: HTMLElement): boolean {
  return element.isConnected && parent.isConnected && parent.moveBefore !== undefined;
}

function moveElement(parent: HTMLElement, element: HTMLElement): void {
  if (canMovePreservingState(parent, element)) {
    parent.moveBefore(element, null);
  } else {
    parent.append(element);
  }
}
