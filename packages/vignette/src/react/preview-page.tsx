/**
 * The preview page behind `vignette dev`, `vignette build` and `vignette preview`: a client like
 * any other, with the built-in plugins and nothing else. Frames render as iframes of the frame
 * page; a kind without a plugin renders an empty box and shows as `error` in status.
 *
 * @module
 */
import { QueryClient, QueryClientProvider, useIsFetching } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { useStreamStatus } from "./hooks.js";
import { Stage } from "./stage.js";
import { Stream } from "./stream.js";

/**
 * Renders the stream at `stream` into `#preview`, filling the window: the scene named by
 * `?scene=`, else the show's active scene.
 */
export function mountPreview(stream: string): void {
  const root = document.getElementById("preview");
  if (root === null) throw new Error("The preview page has no #preview element.");
  const scene = new URLSearchParams(location.search).get("scene") ?? undefined;
  createRoot(root).render(
    <QueryClientProvider client={new QueryClient()}>
      <Stream url={stream} checkPlugins={false}>
        <Stage scene={scene} style={{ width: "100vw", height: "100vh" }} />
        <Ready />
      </Stream>
    </QueryClientProvider>,
  );
}

/**
 * Marks `<body>` for `vignette preview`'s screenshot: `data-vignette-preview="ready"` once the
 * stream is settled and no asset is downloading, `data-vignette-preview-error` on failure.
 */
function Ready(): ReactNode {
  const status = useStreamStatus();
  const fetching = useIsFetching();
  useEffect(() => {
    // An error marks the page failed; otherwise it is ready once settled with nothing fetching.
    if (status.phase === "error") {
      document.body.dataset.vignettePreviewError = status.error?.message ?? "target error";
    } else if (status.phase === "settled" && fetching === 0) {
      document.body.dataset.vignettePreview = "ready";
    }
  }, [status, fetching]);
  return null;
}
