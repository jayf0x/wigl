// DEMO — proves the DOM tier (bunfig.toml's happy-dom preload) actually
// works, nothing more. Not a real regression test for anything; replace/
// delete once a real DOM-level test exists (see tests/backlog.md for what's
// actually queued).
//
// The one non-obvious thing this demo confirms: happy-dom's PointerEvent
// constructor accepts and round-trips `screenX`/`screenY` directly — the
// exact fields Desktop.tsx's drag logic reads (see commit 0f792ec's
// cross-monitor drag fix in git history) — so a future drag/reflow test
// can synthesize a cross-monitor pointer move without a real cursor or
// Tauri runtime.
import { describe, expect, test } from "bun:test";

describe("DOM tier demo", () => {
  test("a synthetic PointerEvent's screenX/screenY reach a real listener", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const captured: { seen: { screenX: number; screenY: number } | null } = { seen: null };
    el.addEventListener("pointermove", (e) => {
      const pe = e as PointerEvent;
      captured.seen = { screenX: pe.screenX, screenY: pe.screenY };
    });

    el.dispatchEvent(new PointerEvent("pointermove", { screenX: 2053, screenY: -323, bubbles: true }));

    expect(captured.seen).toEqual({ screenX: 2053, screenY: -323 });
    el.remove();
  });
});
