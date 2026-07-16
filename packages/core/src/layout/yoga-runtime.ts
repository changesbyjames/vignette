import Yoga, {
  BoxSizing,
  Direction,
  Errata,
  FlexDirection,
  type Config as YogaConfig,
  type Node as YogaNode,
} from "yoga-layout";

import type { LayoutNode } from "../authoring.js";
import type { Size } from "../geometry.js";
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
    nodes: readonly LayoutNode[],
    canvas: Size,
    observer?: YogaAllocationObserver,
  ): YogaSceneTree {
    const config = Yoga.Config.create();
    config.setUseWebDefaults(false);
    config.setPointScaleFactor(0);
    config.setErrata(Errata.None);

    const root = Yoga.Node.create(config);
    let allocationCount = 1;
    observer?.allocate();

    try {
      root.setBoxSizing(BoxSizing.BorderBox);
      root.setFlexDirection(FlexDirection.Column);
      root.setWidth(canvas.width);
      root.setHeight(canvas.height);

      const records: YogaLayoutRecord[] = [];
      nodes.forEach((node, index) => {
        const record = buildRecord(node, config, `children[${String(index)}]`, observer, () => {
          allocationCount += 1;
        });
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

  calculate(canvas: Size): void {
    this.assertActive();
    this.root.calculateLayout(canvas.width, canvas.height, Direction.LTR);
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
  node: LayoutNode,
  config: YogaConfig,
  path: string,
  observer: YogaAllocationObserver | undefined,
  allocated: () => void,
): YogaLayoutRecord {
  const yoga = Yoga.Node.create(config);
  observer?.allocate();
  allocated();

  try {
    applyLayoutStyle(yoga, node.style);
    const children: YogaLayoutRecord[] = [];
    if (node.kind === "box") {
      node.children.forEach((child, index) => {
        const record = buildRecord(
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
