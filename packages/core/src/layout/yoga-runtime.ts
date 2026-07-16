import type { Config as YogaConfig, Node as YogaNode, Yoga } from "yoga-layout/load";

import type { LayoutNode } from "../authoring.js";
import type { Size } from "../geometry.js";
import type { LayoutEngine, LayoutRecord } from "./layout-engine.js";
import { applyLayoutStyle } from "./style.js";

export interface YogaLayoutRecord {
  readonly node: LayoutNode;
  readonly yoga: YogaNode;
  readonly path: string;
  readonly children: readonly YogaLayoutRecord[];
}

export interface YogaAllocationObserver {
  allocate(): void;
  free(): void;
}

export class YogaSceneTree {
  readonly root: YogaNode;
  readonly records: readonly YogaLayoutRecord[];

  readonly #config: YogaConfig;
  readonly #observer: YogaAllocationObserver | undefined;
  #allocationCount = 0;
  #disposed = false;

  private constructor(
    config: YogaConfig,
    root: YogaNode,
    records: readonly YogaLayoutRecord[],
    observer: YogaAllocationObserver | undefined,
    allocationCount: number,
  ) {
    this.#config = config;
    this.root = root;
    this.records = records;
    this.#observer = observer;
    this.#allocationCount = allocationCount;
  }

  static create(
    yoga: Yoga,
    nodes: readonly LayoutNode[],
    canvas: Size,
    observer?: YogaAllocationObserver,
  ): YogaSceneTree {
    const config = yoga.Config.create();
    config.setUseWebDefaults(false);
    config.setPointScaleFactor(0);
    config.setErrata(yoga.ERRATA_NONE);

    const root = yoga.Node.create(config);
    let allocationCount = 1;
    observer?.allocate();

    try {
      root.setBoxSizing(yoga.BOX_SIZING_BORDER_BOX);
      root.setFlexDirection(yoga.FLEX_DIRECTION_COLUMN);
      root.setWidth(canvas.width);
      root.setHeight(canvas.height);

      const records: YogaLayoutRecord[] = [];
      nodes.forEach((node, index) => {
        const record = buildRecord(
          yoga,
          node,
          config,
          `children[${String(index)}]`,
          observer,
          () => {
            allocationCount += 1;
          },
        );
        root.insertChild(record.yoga, root.getChildCount());
        records.push(record);
      });

      return new YogaSceneTree(config, root, records, observer, allocationCount);
    } catch (error) {
      root.freeRecursive();
      for (let index = 0; index < allocationCount; index += 1) observer?.free();
      config.free();
      throw error;
    }
  }

  calculate(canvas: Size, direction: Parameters<YogaNode["calculateLayout"]>[2]): void {
    this.assertActive();
    this.root.calculateLayout(canvas.width, canvas.height, direction);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.root.freeRecursive();
    for (let index = 0; index < this.#allocationCount; index += 1) this.#observer?.free();
    this.#config.free();
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error("Yoga scene tree has been disposed.");
  }
}

function buildRecord(
  yogaModule: Yoga,
  node: LayoutNode,
  config: YogaConfig,
  path: string,
  observer: YogaAllocationObserver | undefined,
  allocated: () => void,
): YogaLayoutRecord {
  const yoga = yogaModule.Node.create(config);
  observer?.allocate();
  allocated();

  try {
    applyLayoutStyle(yogaModule, yoga, node.style);
    const children: YogaLayoutRecord[] = [];
    if (node.kind === "box") {
      node.children.forEach((child, index) => {
        const record = buildRecord(
          yogaModule,
          child,
          config,
          `${path}.children[${String(index)}]`,
          observer,
          allocated,
        );
        yoga.insertChild(record.yoga, yoga.getChildCount());
        children.push(record);
      });
    }
    return { node, yoga, path, children };
  } catch (error) {
    yoga.freeRecursive();
    observer?.free();
    throw error;
  }
}

/** Adapts a compatible Yoga API instance to Vignette's target-neutral layout contract. */
export function createYogaLayoutEngine(yoga: Yoga): LayoutEngine {
  return {
    layout(nodes, canvas) {
      const tree = YogaSceneTree.create(yoga, nodes, canvas);
      try {
        tree.calculate(canvas, yoga.DIRECTION_LTR);
        return tree.records.map(materializeRecord);
      } finally {
        tree.dispose();
      }
    },
  };
}

function materializeRecord(record: YogaLayoutRecord): LayoutRecord {
  const layout = record.yoga.getComputedLayout();
  return {
    node: record.node,
    frame: { x: layout.left, y: layout.top, width: layout.width, height: layout.height },
    path: record.path,
    children: record.children.map(materializeRecord),
  };
}
