import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Dev-only re-render overlay, per window (each widget's own JS realm gets
// its own overlay). import.meta.env.DEV is statically false in prod builds,
// so bundlers dead-code-eliminate this block — react-scan never ships.
if (import.meta.env.DEV) {
  import("react-scan").then(({ scan }) => scan({ enabled: true }));
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
