import { frame } from "@cbj/react-obs-frame";
import { z } from "zod";

export const animalDisclaimer = frame({
  params: z.object({}),
  view: () => (
    <div
      data-testid="animal-disclaimer-frame"
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: "0 18px 15px 0",
        color: "white",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 17,
        fontWeight: 700,
        lineHeight: 1.2,
        textAlign: "right",
        textShadow:
          "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 3px 6px rgba(0,0,0,.9)",
      }}
    >
      The rescued animals on screen are educational ambassadors, not pets.
    </div>
  ),
});
