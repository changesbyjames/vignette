/**
 * The `motion` layer kind: a `<Layer>` with `initial`, `animate`, `exit` and `transition`, as in
 * Motion. The values are offsets on top of the layer's laid-out rest state (its Yoga frame,
 * `opacity` and `rotation`), so Yoga keeps owning layout. Every target needs the kind's plugin:
 * `motionReactLayer`, `motionDomLayer` or `motionObsLayer`.
 *
 * @module
 */
import { defineLayer, type Item } from "@strangecyan/vignette";
import { z } from "zod";

/** What can be animated: offsets on the rest state. */
export const MotionValuesSchema = z
  .object({
    /** Pixels right of the rest position. */
    x: z.number().optional(),
    /** Pixels below the rest position. */
    y: z.number().optional(),
    /** Multiplies the rest size about its centre. */
    scale: z.number().positive().optional(),
    /** Degrees added to the rest rotation. */
    rotate: z.number().optional(),
    /** Multiplies the rest opacity. */
    opacity: z.number().min(0).max(1).optional(),
  })
  .readonly();
export type MotionValues = z.output<typeof MotionValuesSchema>;

/** A spring, by feel (`visualDuration`, `bounce`, as Motion and SwiftUI) or by physics. */
export const SpringTransitionSchema = z
  .object({
    type: z.literal("spring"),
    /** Seconds until the value first reaches its target; about the perceived duration. */
    visualDuration: z.number().positive().optional(),
    /** 0 is critically damped; towards 1 it bounces more. */
    bounce: z.number().min(0).max(1).optional(),
    stiffness: z.number().positive().optional(),
    damping: z.number().nonnegative().optional(),
    mass: z.number().positive().optional(),
  })
  .readonly();

/** A duration-based easing curve. Interrupted, it carries its velocity into the next motion. */
export const TweenTransitionSchema = z
  .object({
    type: z.literal("tween"),
    duration: z.number().positive(),
    ease: z.enum(["linear", "easeIn", "easeOut", "easeInOut", "circOut", "backOut"]).optional(),
    delay: z.number().nonnegative().optional(),
  })
  .readonly();

export type TweenTransition = z.output<typeof TweenTransitionSchema>;

export const TransitionSchema = z.union([SpringTransitionSchema, TweenTransitionSchema]);
export type Transition = z.output<typeof TransitionSchema>;

/** Props of `<MotionLayer>` beyond a plain layer's. */
export const MotionSchema = z.object({
  /** Where the layer starts when it first appears; `false` starts at rest, with no enter. */
  initial: z.union([MotionValuesSchema, z.literal(false)]).optional(),
  /** Where the layer is; the rest state when omitted. A change retargets the running motion. */
  animate: MotionValuesSchema.optional(),
  /** Where the layer goes before it is removed. Interrupted by a return, it comes back. */
  exit: MotionValuesSchema.optional(),
  transition: TransitionSchema.optional(),
  /** Animate changes of the laid-out frame instead of snapping to them. Default `true`. */
  layout: z.boolean().optional(),
});
export type Motion = z.output<typeof MotionSchema>;
export type MotionProps = Motion;

/** A layer that animates between its rest state and `initial`, `animate` and `exit` offsets. */
export const MotionLayer = defineLayer({ kind: "motion", props: MotionSchema });

/** The kind's name, as items carry it. */
export const MOTION_KIND = MotionLayer.definition.kind;

export const DEFAULT_TRANSITION: Transition = { type: "spring", visualDuration: 0.4, bounce: 0.2 };

/** The motion props of an item of this kind; undefined for any other kind. */
export function motionOf(item: Item): MotionProps | undefined {
  return item.kind === MOTION_KIND ? MotionSchema.parse(item.props) : undefined;
}

/** Resolved spring physics, mass included. */
export interface SpringPhysics {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/**
 * Spring physics; `visualDuration` and `bounce` map as in Motion (`motion-dom`'s spring).
 * Explicit physics win over feel; each omitted value takes Motion's default.
 */
export function springPhysics(transition: Transition): SpringPhysics {
  if (transition.type !== "spring") throw new Error("Not a spring.");
  return transition.stiffness === undefined ? feelPhysics(transition) : explicitPhysics(transition);
}

type SpringTransition = z.output<typeof SpringTransitionSchema>;

/** Physics from `visualDuration` and `bounce`, as Motion maps them. */
function feelPhysics(transition: SpringTransition): SpringPhysics {
  const visualDuration = transition.visualDuration ?? 0.4;
  const root = (2 * Math.PI) / (visualDuration * 1.2);
  const stiffness = root * root;
  const zeta = Math.max(1 - (transition.bounce ?? 0.2), 0.05);
  return { stiffness, damping: 2 * zeta * Math.sqrt(stiffness), mass: 1 };
}

/** Explicit physics, with Motion's defaults for what is omitted. */
function explicitPhysics(transition: SpringTransition): SpringPhysics {
  return {
    stiffness: transition.stiffness ?? 100,
    damping: transition.damping ?? 10,
    mass: transition.mass ?? 1,
  };
}

// Motion's cubic-bezier, solved for x by Newton iteration then bisection where Newton stalls.
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const a = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
  const b = (a1: number, a2: number) => 3 * a2 - 6 * a1;
  const c = (a1: number) => 3 * a1;
  const calc = (t: number, a1: number, a2: number) => ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t;
  const slope = (t: number, a1: number, a2: number) =>
    3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1);
  return (x) => {
    // Clamp outside [0, 1]; inside, Newton from x, then bisection if it has not converged.
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (calc(t, x1, x2) - x) / s;
    }
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30 && Math.abs(calc(t, x1, x2) - x) > 1e-7; i++) {
      if (calc(t, x1, x2) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return calc(t, y1, y2);
  };
}

/** The named easing curves, as Motion defines them. */
export const EASES = {
  linear: (x) => x,
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeInOut: cubicBezier(0.42, 0, 0.58, 1),
  circOut: (x) => Math.sqrt(1 - (x - 1) ** 2),
  backOut: cubicBezier(0.34, 1.56, 0.64, 1),
} satisfies Readonly<Record<NonNullable<TweenEase>, (x: number) => number>>;
type TweenEase = TweenTransition["ease"];

/** Samples an easing curve at 240 Hz, so a target only ever interpolates linearly. */
export function sampleEase(ease: TweenEase, duration: number): readonly number[] {
  const curve = EASES[ease ?? "easeOut"];
  const n = Math.max(2, Math.ceil(duration * 240) + 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Number(curve(i / (n - 1)).toFixed(6)));
  return out;
}
