import type { ReactNode } from "react";

/** Props of {@link PageFrame}. */
export interface PageFrameProps {
  readonly url: string;
  readonly title: string;
}

/**
 * A sandboxed iframe filling the source's box, which is `source.size`, so the page lays out at
 * its viewport. React only sets `src` when the URL changes, so nothing else reloads the page.
 */
export function PageFrame({ url, title }: PageFrameProps): ReactNode {
  return (
    <iframe
      src={url}
      title={title}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      tabIndex={-1}
      style={{ display: "block", border: 0, width: "100%", height: "100%" }}
    />
  );
}
