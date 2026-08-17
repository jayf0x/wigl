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
