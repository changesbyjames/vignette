import { frame } from "@cbj/vignette-frame";
import { z } from "zod";

export const sanctuaryLinks = frame({
  params: z.object({}),
  view: () => (
    <div
      data-testid="sanctuary-links-frame"
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "flex-end",
        gap: 13,
        padding: "0 0 14px 20px",
        color: "white",
        fontFamily: "Arial, Helvetica, sans-serif",
        textShadow:
          "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 3px 6px rgba(0,0,0,.9)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          width: 54,
          height: 54,
          border: "3px solid rgba(255,255,255,.92)",
          borderRadius: "50%",
          background: "rgba(24, 54, 36, .72)",
          fontSize: 30,
          fontWeight: 700,
          boxShadow: "0 3px 10px rgba(0,0,0,.55)",
        }}
      >
        A
      </div>
      <div style={{ paddingBottom: 1, fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>
        <div>alveussanctuary.org</div>
        <div>@alveussanctuary</div>
      </div>
    </div>
  ),
});
