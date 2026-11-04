import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MoqView } from "@strangecyan/vignette-moq/react";
import { Suspense, type ReactElement } from "react";
import { Stage, Stream, useStreamStatus } from "@strangecyan/vignette/react";

const queryClient = new QueryClient();
const sources = [MoqView];

/**
 * The browser preview: one stream, one stage following the show's active scene. The page knows
 * nothing about the show: frames render as iframes of the frame page, like in OBS.
 */
export function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <Stream url="/stream" sources={sources}>
        <main>
          <header>
            <div>
              <p className="eyebrow">Vignette example</p>
              <h1>Kitchen sink</h1>
            </div>
            <Status />
          </header>
          <section className="preview-shell">
            <Suspense fallback={null}>
              <Stage className="preview" />
            </Suspense>
          </section>
        </main>
      </Stream>
    </QueryClientProvider>
  );
}

/** Connection phase and the revision on screen, from `useStreamStatus`. */
function Status(): ReactElement {
  const { phase, revision, error } = useStreamStatus();
  return (
    <div className="status-grid">
      <div className="status">
        <span>Revision</span>
        <strong data-testid="revision">{revision.settled ?? "–"}</strong>
      </div>
      <div className="status">
        <span>Stream</span>
        <strong data-testid="phase" title={error?.message}>
          {phase}
        </strong>
      </div>
    </div>
  );
}
