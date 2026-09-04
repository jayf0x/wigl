// Cross-monitor drag coordinate correction (Desktop.tsx's `DragState.screenCorrection`,
// see commit 0f792ec). `PointerEvent.screenY` reports a coordinate relative
// to the *capturing* window's own origin (not the desktop), once pointer
// capture keeps events flowing after the cursor leaves that window during a
// cross-monitor drag — screenX has no such issue. The synthetic events below
// simulate exactly that: screenX stays a true global coordinate, screenY is
// reported window-relative (equal to clientY) throughout the drag, which is
// the observed WebKit behavior this fix corrects for.
import { mock, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { expect } from "bun:test";
import * as React from "react";
import { mockStorage } from "./mock-storage";

const storage = mockStorage();
storage.kv.set("widget_layout", JSON.stringify({ w1: { col: 0, row: 0, m: 0 } }));

mock.module("@tauri-apps/api/core", () => {
  const actual = require("@tauri-apps/api/core");
  return { ...actual, invoke: async () => undefined };
});
mock.module("@tauri-apps/api/window", () => ({
  // Home monitor sits at a nonzero y origin (1000) and the foreign monitor
  // at y: 0 — an offset in both axes, so a correction that only worked by
  // accident (e.g. a flat 0 origin masking the bug) wouldn't pass.
  availableMonitors: async () => [
    { name: "0", position: { x: 0, y: 1000 }, size: { width: 1000, height: 800 }, scaleFactor: 1 },
    { name: "1", position: { x: 1000, y: 0 }, size: { width: 1000, height: 800 }, scaleFactor: 1 },
  ],
}));

const { Desktop } = await import("../src/wigl/Desktop");
const { listen } = await import("@tauri-apps/api/event");

const DragHandle = () => React.createElement("div", { "data-drag-handle": true, "data-testid": "handle" });

test("a monitor y-offset doesn't distort where a cross-monitor drag lands", async () => {
  let preview: unknown = null;
  const unlisten = await listen("wigl-preview", (e: { payload: unknown }) => {
    preview = e.payload;
  });

  const { container } = render(
    React.createElement(Desktop, { widgets: { w1: DragHandle }, monitorIndex: 0, windowed: false }),
  );

  // Let storage resolve and availableMonitors() populate monitors.current.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
  const root = container.querySelector(".wigl-desktop") as HTMLElement;

  // Drag start, still inside the home window/monitor: global (50, 1050).
  // clientY and the (buggy) screenY both report the window-relative value
  // (50) at this point — this is what calibrates screenCorrection.
  await act(async () => {
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 50,
        clientY: 50,
        screenX: 50,
        screenY: 50,
      }),
    );
  });

  // Cursor is now over the foreign monitor at true global (1500, 300).
  // screenX correctly reports the global value (1500); the buggy screenY
  // instead reports window-relative (-700 = 300 - 1000, the home monitor's
  // y origin) instead of the true global 300.
  await act(async () => {
    root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: 1500,
        clientY: -700,
        screenX: 1500,
        screenY: -700,
      }),
    );
  });

  // Corrected sy recovers the true global y (300), so the cursor resolves
  // onto monitor 1 with the widget landing at col 5 / row 3 — not stuck on
  // the home monitor with the drag never even registering as cross-monitor
  // (what an uncorrected screenY produces: no monitor's rect contains sy).
  expect(preview).toEqual({ id: "w1", to: 1, w: 3, h: 4, col: 5, row: 3, cx: 500, cy: 300 });

  unlisten();
  storage.restore();
});

// Reproduces the owner's live "duplicate left behind on the source monitor"
// repro (see commit fixing Bug A/B/C in git history) as a deterministic,
// single-window test — no second monitor window needed, since the race is
// entirely within the *source* monitor's own effects: endDrag drops the id
// from `layout`, which re-fires the "missing ids" reconcile effect a few
// lines below (gated on `[loading, layout, widgets, monitorIndex]`, not on
// `saved`); that effect re-places any id still in `widgets` but missing from
// `layout` by checking `saved[id].m` — so it must already agree the id left
// this monitor, or it silently re-adds a widget that was just handed off.
test("a widget dropped onto another monitor doesn't reappear on the source monitor", async () => {
  storage.kv.set("widget_layout", JSON.stringify({ w1: { col: 0, row: 0, m: 0 } }));

  const { container } = render(
    React.createElement(Desktop, { widgets: { w1: DragHandle }, monitorIndex: 0, windowed: false }),
  );

  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  expect(container.querySelector('[data-widget-id="w1"]')).not.toBeNull();

  const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
  const root = container.querySelector(".wigl-desktop") as HTMLElement;

  await act(async () => {
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 50,
        clientY: 50,
        screenX: 50,
        screenY: 50,
      }),
    );
  });

  // Same foreign-monitor coordinates as the test above — lands the drag
  // target on monitor 1.
  await act(async () => {
    root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: 1500,
        clientY: -700,
        screenX: 1500,
        screenY: -700,
      }),
    );
  });

  // Drop while still over the foreign monitor — this is endDrag's
  // cross-monitor branch: it removes w1 from this window's own `layout`
  // and (the fix) flips `saved.w1.m` to 1 in the same synchronous handler.
  await act(async () => {
    root.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  });

  // Let every effect this triggers — including the "missing ids" reconcile
  // effect — settle. Without the fix, that effect sees `layout` missing w1
  // but `saved.w1.m` still claiming monitor 0, and re-adds it right here.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  expect(container.querySelector('[data-widget-id="w1"]')).toBeNull();
  // The source's own optimistic write should also have moved on in storage,
  // independent of any second monitor window ever persisting anything.
  expect(JSON.parse(storage.kv.get("widget_layout")!).w1.m).toBe(1);

  storage.restore();
});

// A second, independent bug the above test's fix surfaced (confirmed live
// with a standalone repro, then confirmed it reproduces on unmodified code
// too — nothing to do with the endDrag fix above): the "missing ids"
// reconcile effect's `widgets` prop is every discovered plugin on disk, the
// *same* set on every monitor window (see loadPlugins()/App.tsx), not
// filtered to this monitor's own. So `missing` routinely contains ids that
// belong to some other, perfectly valid monitor — the ordinary case of two
// widgets split across two monitors, not an edge case. Before this fix, the
// effect's `setLayout` updater unconditionally returned a fresh `[...prev]`
// array even when nothing was actually placed into it, which is a new
// reference every time — React never bails out of the re-render, `layout`
// keeps "changing" (in reference only), and the effect (keyed on `layout`)
// re-fires forever. The `test()` timeout below is best-effort, not a real
// backstop — confirmed live that the actual failure mode starves the event
// loop badly enough that even this timeout doesn't reliably fire, so a
// regression here still means killing a hung `bun test` by hand — but it
// costs nothing to leave in place, and it's what tells you *why* the run
// hung instead of leaving that to be rediscovered from scratch.
test(
  "a widget belonging to another monitor doesn't loop the reconcile effect forever",
  async () => {
    storage.kv.set(
      "widget_layout",
      JSON.stringify({ w1: { col: 0, row: 0, m: 0 }, w2: { col: 0, row: 0, m: 1 } }),
    );

    // Monitor 1's own widget (w2) plus one that only ever belongs to
    // monitor 0 (w1) — w1 is permanently "missing" from monitor 1's layout,
    // by design, not a bug to fix in `saved`.
    const { container } = render(
      React.createElement(Desktop, {
        widgets: { w1: DragHandle, w2: DragHandle },
        monitorIndex: 1,
        windowed: false,
      }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(container.querySelector('[data-widget-id="w2"]')).not.toBeNull();
    expect(container.querySelector('[data-widget-id="w1"]')).toBeNull();

    storage.restore();
  },
  5000,
);
