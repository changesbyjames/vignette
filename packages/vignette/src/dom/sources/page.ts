/**
 * An iframe for a web page. Its CSS size is the source's viewport, set by the target's placement,
 * so the page lays out at that size and is scaled into its layer.
 */
export function createPageFrame(document: Document, url: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.tabIndex = -1;
  frame.src = url;
  return frame;
}

/** Navigates only when the URL changed, so updating anything else keeps the page alive. */
export function navigatePageFrame(frame: HTMLIFrameElement, url: string): void {
  if (frame.getAttribute("src") !== url) frame.src = url;
}

/** Unloads the page and removes the frame. */
export function disposePageFrame(frame: HTMLIFrameElement): void {
  frame.src = "about:blank";
  frame.remove();
}
