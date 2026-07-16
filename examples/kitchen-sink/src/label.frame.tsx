import { frame } from "@cbj/vignette-frame";
import { z } from "zod";

export const labelFrame = frame({
  params: z.object({
    eyebrow: z.string(),
    title: z.string(),
    detail: z.string(),
    accent: z.string(),
  }),
  view: ({ eyebrow, title, detail, accent }) => (
    <div
      data-testid="label-frame"
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 32,
        color: "#fafafa",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div style={{ color: accent, fontSize: 18, fontWeight: 700, letterSpacing: "0.12em" }}>
        {eyebrow}
      </div>
      <div>
        <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-0.035em" }}>{title}</div>
        <div style={{ marginTop: 10, color: "#a3a3a3", fontSize: 20 }}>{detail}</div>
      </div>
    </div>
  ),
});
