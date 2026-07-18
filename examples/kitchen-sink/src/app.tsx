import { moqDomRenderer } from "@strangecyan/vignette-moq/dom";
import { sseRuntimeSource, useCompositor } from "@strangecyan/vignette-target-dom/react";
import type { ReactElement } from "react";

const transport = sseRuntimeSource("/runtime");
const extensions = [moqDomRenderer];
const reportCompositorError = (error: Error) => {
  console.error(error);
};

export function App(): ReactElement {
  const [stageRef, compositor] = useCompositor({
    sceneId: "main",
    transport,
    extensions,
    onError: reportCompositorError,
  });

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Vignette example</p>
          <h1>Kitchen sink</h1>
        </div>
        <div className="status-grid">
          <div className="status">
            <span>Snapshot</span>
            <strong data-testid="commit-status">{compositor.revision}</strong>
          </div>
          <div className="status">
            <span>DOM runtime</span>
            <strong data-testid="dom-status">{compositor.phase}</strong>
          </div>
        </div>
      </header>
      <section className="preview-shell">
        <div className="preview" ref={stageRef} data-testid="stage" />
      </section>
    </main>
  );
}
