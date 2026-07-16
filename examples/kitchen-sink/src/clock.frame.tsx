import { frame } from "@cbj/vignette-frame";
import { useEffect, useState } from "react";
import { z } from "zod";

export const clockFrame = frame({
  params: z.object({ title: z.string() }),
  view: ({ title }) => {
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

    return (
      <div
        data-testid="clock-frame"
        data-hydrated={String(now !== null)}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 38px",
          color: "#171717",
          background: "#f5f5f4",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 46, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.04em" }}>
          {now?.toLocaleTimeString("en-GB") ?? "--:--:--"}
        </div>
      </div>
    );
  },
});
