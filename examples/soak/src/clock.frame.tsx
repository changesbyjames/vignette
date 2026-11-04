import { useEffect, useState } from "react";
import { frame } from "@strangecyan/vignette/frame";
import { z } from "zod";

import { elapsed } from "./time.js";

/** Wall-clock time and time since `startedAt`, ticking in the page, so slips show on stream. */
export const Clock = frame({
  name: "Clock",
  params: z.object({ title: z.string(), startedAt: z.number() }),
  view: ({ title, startedAt }) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
      const timer = setInterval(() => {
        setNow(Date.now());
      }, 250);
      return () => {
        clearInterval(timer);
      };
    }, []);

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 36px",
          color: "#171717",
          background: "#f5f5f4",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 700 }}>{title}</div>
        <div style={{ display: "flex", gap: 36, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ fontSize: 26, color: "#737373" }}>T+{elapsed(now - startedAt)}</span>
          <span style={{ fontSize: 44, letterSpacing: "-0.04em" }}>
            {new Date(now).toLocaleTimeString("en-GB")}
          </span>
        </div>
      </div>
    );
  },
});
