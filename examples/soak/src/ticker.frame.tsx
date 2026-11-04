import { useEffect, useState } from "react";
import { frame } from "@strangecyan/vignette/frame";
import { z } from "zod";

/**
 * A scrolling ticker animated every display frame. The show mounts and unmounts it on a timer, so
 * OBS creates and removes its browser source over and over.
 */
export const Ticker = frame({
  name: "Ticker",
  params: z.object({ message: z.string() }),
  view: ({ message }) => {
    const [offset, setOffset] = useState(0);

    useEffect(() => {
      let handle = 0;
      const step = (time: number) => {
        setOffset((time / 8) % 1920);
        handle = requestAnimationFrame(step);
      };
      handle = requestAnimationFrame(step);
      return () => {
        cancelAnimationFrame(handle);
      };
    }, []);

    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "#facc15",
          color: "#1c1917",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 34,
          fontWeight: 700,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            whiteSpace: "nowrap",
            transform: `translate(${String(1920 - offset)}px, -50%)`,
          }}
        >
          {message}
        </div>
      </div>
    );
  },
});
