/** What a source shows: a video element, or a canvas it draws into. */
export type PictureInput = HTMLVideoElement | HTMLCanvasElement;

/**
 * Shows a source's picture `delay` ms late, for a channel whose audio must lead its picture. It
 * captures frames as `VideoFrame`s, holds them, and draws the one `delay` old into `canvas`,
 * which the target lays over the source's own element. Until it holds `delay` ms of frames (after
 * it starts, a restart or a seek) the canvas is hidden, so the live picture shows instead of
 * nothing.
 */
export interface DelayLine {
  readonly canvas: HTMLCanvasElement;
  readonly picture: PictureInput;
  /** False where the browser has no `VideoFrame`; the canvas then stays hidden. */
  readonly supported: boolean;
  setDelay(ms: number): void;
  /** Drops every held frame, after a restart or seek. */
  reset(): void;
  dispose(): void;
}

/** A captured frame and when, in `performance.now()` ms, it was shown live. */
interface HeldFrame {
  readonly frame: VideoFrame;
  readonly at: number;
}

/** Frames held per second of delay, at most: enough for 60 fps with headroom. */
const MAX_FRAMES_PER_SECOND = 75;

/** Creates a delay line for `picture` in its document. */
export function createDelayLine(picture: PictureInput, delayMs: number): DelayLine {
  const document = picture.ownerDocument;
  const view = document.defaultView;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.vignetteDelayLine = "";
  canvas.style.visibility = "hidden";
  const supported = view !== null && "VideoFrame" in view && "requestAnimationFrame" in view;
  const held: HeldFrame[] = [];
  let shown: HeldFrame | undefined = undefined;
  let delay = delayMs;
  let stopped = false;
  let animation = 0;

  function capture(at: number): void {
    if (!ready(picture) || view === null) return;
    try {
      held.push({ frame: new view.VideoFrame(picture, { timestamp: Math.round(at * 1000) }), at });
    } catch {
      return;
    }
    // Never hold more than the delay needs, whatever the source's frame rate.
    const limit = Math.ceil((delay / 1000) * MAX_FRAMES_PER_SECOND) + 2;
    while (held.length > limit) held.shift()?.frame.close();
  }

  /** Draws the newest frame that is `delay` old, closing the ones it skips and replaces. */
  function draw(now: number): void {
    const due = takeDue(now - delay);
    if (due !== undefined) {
      shown?.frame.close();
      shown = due;
      paint(canvas, due.frame);
    }
    canvas.style.visibility = shown === undefined ? "hidden" : "visible";
  }

  /** Removes the frames shown live at or before `cutoff`, returning the newest of them. */
  function takeDue(cutoff: number): HeldFrame | undefined {
    let due: HeldFrame | undefined = undefined;
    while (held[0] !== undefined && held[0].at <= cutoff) {
      due?.frame.close();
      due = held.shift();
    }
    return due;
  }

  // A video is captured once per new frame where the browser says when that is; anything else,
  // and a video elsewhere, once per animation frame.
  const perVideoFrame =
    picture instanceof HTMLVideoElement && "requestVideoFrameCallback" in picture;
  function onVideoFrame(): void {
    if (stopped || !(picture instanceof HTMLVideoElement)) return;
    capture(performance.now());
    picture.requestVideoFrameCallback(onVideoFrame);
  }
  function onAnimationFrame(now: number): void {
    if (stopped || view === null) return;
    if (!perVideoFrame) capture(now);
    draw(now);
    animation = view.requestAnimationFrame(onAnimationFrame);
  }
  const reset = () => {
    for (const entry of held.splice(0)) entry.frame.close();
    shown?.frame.close();
    shown = undefined;
    canvas.style.visibility = "hidden";
  };
  if (supported && view !== null) {
    if (picture instanceof HTMLVideoElement && perVideoFrame) {
      picture.requestVideoFrameCallback(onVideoFrame);
    }
    animation = view.requestAnimationFrame(onAnimationFrame);
    picture.addEventListener("seeking", reset);
  }

  return {
    canvas,
    picture,
    supported,
    setDelay(ms) {
      delay = ms;
    },
    reset,
    dispose() {
      stopped = true;
      view?.cancelAnimationFrame(animation);
      picture.removeEventListener("seeking", reset);
      reset();
      canvas.remove();
    },
  };
}

/** Draws `frame` into `canvas`, sized to it. */
function paint(canvas: HTMLCanvasElement, frame: VideoFrame): void {
  const { displayWidth, displayHeight } = frame;
  if (canvas.width !== displayWidth) canvas.width = displayWidth;
  if (canvas.height !== displayHeight) canvas.height = displayHeight;
  canvas.getContext("2d")?.drawImage(frame, 0, 0);
}

/** Whether the picture has a frame to capture. */
function ready(picture: PictureInput): boolean {
  if (picture instanceof HTMLVideoElement) {
    return picture.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && picture.videoWidth > 0;
  }
  return picture.width > 0 && picture.height > 0;
}
