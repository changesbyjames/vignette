import { moqDomRenderer } from "@strangecyan/vignette-moq/dom";
import { sseStream, useStage } from "@strangecyan/vignette-target-dom/react";
import type { ReactElement } from "react";

const stream = sseStream("/stream");
const extensions = [moqDomRenderer];
const reportStageError = (error: Error) => {
  console.error(error);
};

export function App(): ReactElement {
  const [stageRef, stage] = useStage({
    sceneId: "main",
    stream,
    extensions,
    onError: reportStageError,
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
            <strong data-testid="commit-status">{stage.revision}</strong>
          </div>
          <div className="status">
            <span>DOM stage</span>
            <strong data-testid="dom-status">{stage.phase}</strong>
          </div>
        </div>
      </header>
      <section className="preview-shell">
        <div className="preview" ref={stageRef} data-testid="stage" />
      </section>
    </main>
  );
}
