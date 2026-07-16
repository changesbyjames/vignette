import { frame } from "@cbj/vignette-frame";
import { z } from "zod";

export const testingBanner = frame({
  params: z.object({}),
  view: () => (
    <div
      data-testid="testing-banner-frame"
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        color: "#e11d2e",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 72,
        fontWeight: 700,
        letterSpacing: "-0.025em",
        lineHeight: 1,
        textAlign: "center",
        textShadow:
          "-3px -3px 0 #fff, 0 -3px 0 #fff, 3px -3px 0 #fff, -3px 0 0 #fff, 3px 0 0 #fff, -3px 3px 0 #fff, 0 3px 0 #fff, 3px 3px 0 #fff, 0 7px 12px rgba(0,0,0,.8)",
      }}
    >
      Not Alveus Sanctuary (testing)
    </div>
  ),
});
