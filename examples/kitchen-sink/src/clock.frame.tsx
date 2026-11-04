import { useEffect, useState } from "react";
import { frame } from "@strangecyan/vignette/frame";
import { z } from "zod";

/** A clock that ticks in the page: frames hold their own state and animate. */
export const Clock = frame({
  name: "Clock",
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
        data-mounted={String(now !== null)}
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
        <div data-testid="clock-title" style={{ fontSize: 24, fontWeight: 700 }}>
          {title}
        </div>
        <div
          data-testid="clock-time"
          style={{ fontSize: 46, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.04em" }}
        >
          {now?.toLocaleTimeString("en-GB") ?? "--:--:--"}
        </div>
      </div>
    );
  },
});
