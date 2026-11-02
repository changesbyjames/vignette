import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./styles.css";

const container = document.querySelector("#root");
if (container === null) throw new Error("Kitchen-sink root element is missing.");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
