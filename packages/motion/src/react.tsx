/**
 * The `motion` kind for `@strangecyan/vignette/react`: a `motion.div` with the item's rest frame
 * as its style and the kind's `initial`, `animate` and `exit` as its props, inside
 * `AnimatePresence` so a removed item plays its exit before it unmounts.
 *
 * @module
 */
import type { Item } from "@strangecyan/vignette";
import type { ReactLayerPlugin, ReactPlaceProps } from "@strangecyan/vignette/react";
import { AnimatePresence, motion, type Transition as MotionTransition } from "motion/react";
import type { ReactNode } from "react";

import {
  DEFAULT_TRANSITION,
  MotionLayer,
  motionOf,
  type MotionValues,
  type Transition,
} from "./index.js";

/** The item's box as a `motion.div`; each motion prop falls back to rest when the kind omits it. */
function Place({ item, order, children }: ReactPlaceProps<typeof MotionLayer>): ReactNode {
  const props = motionOf(item) ?? {};
  return (
    <motion.div
      data-vignette-layer={item.id}
      layout={props.layout !== false}
      initial={props.initial === false ? false : values(item, props.initial ?? {})}
      animate={values(item, props.animate ?? {})}
      exit={props.exit === undefined ? undefined : values(item, props.exit)}
      transition={transition(props.transition ?? DEFAULT_TRANSITION)}
      style={{
        position: "absolute",
        overflow: "hidden",
        display: item.visible ? "block" : "none",
        left: item.frame.x,
        top: item.frame.y,
        width: item.frame.width,
        height: item.frame.height,
        transformOrigin: "center center",
        zIndex: order,
      }}
    >
      {children}
    </motion.div>
  );
}

interface PresenceProps {
  readonly children: ReactNode;
}

function Presence({ children }: PresenceProps): ReactNode {
  return <AnimatePresence>{children}</AnimatePresence>;
}

export const motionReactLayer: ReactLayerPlugin<typeof MotionLayer> = {
  kind: MotionLayer.definition.kind,
  Place,
  Presence,
};

/** Motion values on top of the item's rest rotation and opacity. */
function values(item: Item, offsets: MotionValues) {
  return {
    x: offsets.x ?? 0,
    y: offsets.y ?? 0,
    scale: offsets.scale ?? 1,
    rotate: item.rotation + (offsets.rotate ?? 0),
    opacity: item.opacity * (offsets.opacity ?? 1),
  };
}

/** A kind transition as Motion's: a spring by feel or by physics, or a tween. */
function transition(value: Transition): MotionTransition {
  if (value.type === "tween") {
    return { duration: value.duration, ease: value.ease ?? "easeOut", delay: value.delay };
  }
  return value.stiffness === undefined
    ? { type: "spring", visualDuration: value.visualDuration ?? 0.4, bounce: value.bounce ?? 0.2 }
    : { type: "spring", stiffness: value.stiffness, damping: value.damping, mass: value.mass };
}
