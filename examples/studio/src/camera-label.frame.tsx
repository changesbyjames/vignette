import { frame } from "@cbj/react-obs-frame";
import { z } from "zod";

export const cameraLabel = frame({
  params: z.object({
    name: z.string().min(1),
    hero: z.boolean(),
  }),
  view: ({ name, hero }) => (
    <div
      data-testid="camera-label-frame"
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        padding: hero ? "28px 28px 0" : "18px 28px 0",
        color: "white",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: hero ? 34 : 20,
        fontWeight: 700,
        letterSpacing: "0.01em",
        lineHeight: 1.1,
        textAlign: "center",
        textShadow:
          "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 3px 5px rgba(0,0,0,.9)",
      }}
    >
      {name}
    </div>
  ),
});
