import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Errors that happen outside React's render/commit cycle (a rejected
// promise, a throw inside a raw event handler or timer) never reach any
// error boundary — without this they're visible only in this window's own
// devtools console, invisible to both `bun run verify`'s log grep and
// macOS's `log show` (neither sees webview console output). Prefixed with
// [wigl] so they're greppable the same way every other logged error here is.
window.addEventListener("error", (e) => console.error("[wigl] uncaught error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => console.error("[wigl] unhandled rejection", e.reason));

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
