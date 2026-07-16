import { frame } from "@cbj/vignette-frame";
import { useEffect, useState } from "react";
import { z } from "zod";

const TIME_ZONE = "America/Chicago";

export const sanctuaryClock = frame({
  params: z.object({}),
  view: () => {
    const [now, setNow] = useState<Date | null>(null);

    useEffect(() => {
      const update = () => {
        setNow(new Date());
      };
      update();
      const timer = setInterval(update, 1000);
      return () => {
        clearInterval(timer);
      };
    }, []);

    const time =
      now?.toLocaleTimeString("en-US", {
        timeZone: TIME_ZONE,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }) ?? "--:--:-- --";
    const date =
      now?.toLocaleDateString("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }) ?? "---- -- --";

    return (
      <div
        data-testid="sanctuary-clock-frame"
        data-hydrated={String(now !== null)}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          padding: "8px 14px",
          color: "white",
          fontFamily: '"Arial Narrow", Arial, Helvetica, sans-serif',
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          textShadow:
            "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 3px 6px rgba(0,0,0,.9)",
        }}
      >
        <div style={{ fontSize: 35, fontWeight: 700, lineHeight: 1.05 }}>{time} CT</div>
        <div style={{ marginTop: 6, fontSize: 28, fontWeight: 700, lineHeight: 1.05 }}>{date}</div>
        <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700, letterSpacing: "0.12em" }}>
          ALVEUS SANCTUARY
        </div>
      </div>
    );
  },
});
