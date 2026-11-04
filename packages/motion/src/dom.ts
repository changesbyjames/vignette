/**
 * The `motion` kind for `@strangecyan/vignette/dom`: Motion's `animate()` on the item's box. The
 * rest frame is animated too, so a layout change glides and a retarget mid-flight carries its
 * velocity, as in OBS.
 *
 * @module
 */
import type { Item } from "@strangecyan/vignette";
import type { DomLayerPlugin, DomPlacementContext } from "@strangecyan/vignette/dom";
import { animate, type AnimationOptions, type DOMKeyframesDefinition } from "motion";

import {
  DEFAULT_TRANSITION,
  MotionLayer,
  motionOf,
  type MotionValues,
  type Transition,
} from "./index.js";

export const motionDomLayer: DomLayerPlugin<typeof MotionLayer> = {
  kind: MotionLayer.definition.kind,

  place(item, { box, order, previous }) {
    const motion = motionOf(item) ?? {};
    Object.assign(box.style, {
      position: "absolute",
      overflow: "hidden",
      zIndex: String(order),
      display: item.visible ? "block" : "none",
      transformOrigin: "center center",
    });
    box.dataset.vignetteLayer = item.id;
    if (previous === undefined) start(box, item, motion.initial);
    // With `layout`, the frame is animated along with the offsets; otherwise it snaps.
    const glide = motion.layout !== false;
    if (!glide) Object.assign(box.style, frameStyle(item));
    const target: DOMKeyframesDefinition = glide
      ? { ...keyframes(item, motion.animate ?? {}), ...frameStyle(item) }
      : keyframes(item, motion.animate ?? {});
    void animate(box, target, options(motion.transition ?? DEFAULT_TRANSITION));
  },

  async remove(item, { box }: DomPlacementContext) {
    const motion = motionOf(item) ?? {};
    if (motion.exit === undefined) return;
    await animate(
      box,
      keyframes(item, motion.exit),
      options(motion.transition ?? DEFAULT_TRANSITION),
    );
  },
};

/** A new box starts at rest or at `initial`, without animating. */
function start(box: HTMLElement, item: Item, initial: MotionValues | false | undefined): void {
  Object.assign(box.style, frameStyle(item));
  void animate(box, keyframes(item, initial === false ? {} : (initial ?? {})), { duration: 0 });
}

/** The rest frame as CSS, in canvas pixels. */
function frameStyle(item: Item) {
  return {
    left: `${String(item.frame.x)}px`,
    top: `${String(item.frame.y)}px`,
    width: `${String(item.frame.width)}px`,
    height: `${String(item.frame.height)}px`,
  };
}

/** Motion values on top of the item's rest rotation and opacity. */
function keyframes(item: Item, values: MotionValues): DOMKeyframesDefinition {
  return {
    x: values.x ?? 0,
    y: values.y ?? 0,
    scale: values.scale ?? 1,
    rotate: item.rotation + (values.rotate ?? 0),
    opacity: item.opacity * (values.opacity ?? 1),
  };
}

/** A kind transition as Motion's options; a spring by feel or by physics, or a tween. */
function options(transition: Transition): AnimationOptions {
  if (transition.type === "tween") {
    return {
      duration: transition.duration,
      ease: transition.ease ?? "easeOut",
      delay: transition.delay,
    };
  }
  if (transition.stiffness === undefined) {
    return {
      type: "spring",
      visualDuration: transition.visualDuration ?? 0.4,
      bounce: transition.bounce ?? 0.2,
    };
  }
  return {
    type: "spring",
    stiffness: transition.stiffness,
    damping: transition.damping,
    mass: transition.mass,
  };
}
