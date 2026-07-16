import type { CompiledItem, Rect } from "@cbj/react-obs-core";

export function px(value: number): string {
  return `${String(value)}px`;
}

export function applyItemFrame(wrapper: HTMLElement, item: CompiledItem): void {
  Object.assign(wrapper.style, {
    display: item.visible ? "block" : "none",
    left: px(item.frame.x),
    top: px(item.frame.y),
    width: px(item.frame.width),
    height: px(item.frame.height),
    opacity: String(item.opacity),
    transform: item.rotation === 0 ? "" : `rotate(${String(item.rotation)}deg)`,
    transformOrigin: "center center",
  });

  wrapper.style.clipPath = item.clip === undefined ? "" : clipPath(item.frame, item.clip);
}

function clipPath(frame: Rect, clip: Rect): string {
  const top = Math.max(0, clip.y - frame.y);
  const left = Math.max(0, clip.x - frame.x);
  const right = Math.max(0, frame.x + frame.width - clip.x - clip.width);
  const bottom = Math.max(0, frame.y + frame.height - clip.y - clip.height);
  return `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)})`;
}
