// Edge-resize (Desktop.tsx's onResizeStart/onResizeMove/endResize). Dragging
// a widget's east handle should grow its w, push a colliding neighbor down
// via the same reflow() collision pass drag uses, and persist the new size
// — but only for the widget actually resized, not the one it pushed.
import { afterAll, expect, mock, test } from "bun:test";
import { act, render } from "@testing-library/react";
import * as React from "react";
import { mockStorage } from "./mock-storage";

const storage = mockStorage();
storage.kv.set(
  "widget_layout",
  JSON.stringify({
    w1: { col: 2, row: 2, w: 4, h: 3, m: 0 },
    w2: { col: 6, row: 2, w: 2, h: 2, m: 0 },
  }),
);

mock.module("@tauri-apps/api/core", () => {
  const actual = require("@tauri-apps/api/core");
  return { ...actual, invoke: async () => undefined };
});
mock.module("@tauri-apps/api/window", () => ({
  availableMonitors: async () => [
    { name: "0", position: { x: 0, y: 0 }, size: { width: 1000, height: 800 }, scaleFactor: 1 },
  ],
}));

const { Desktop } = await import("../src/wigl/Desktop");

const Stub = () => null;

afterAll(() => storage.restore());

test("resizing a widget's east edge grows it, pushes a colliding neighbor, and persists the new size", async () => {
  const { container } = render(
    React.createElement(Desktop, { widgets: { w1: Stub, w2: Stub }, monitorIndex: 0, windowed: false }),
  );

  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  const handle = container.querySelector('[data-resize-handle="e"]') as HTMLElement;
  const root = container.querySelector(".wigl-desktop") as HTMLElement;

  // Grid pitch is 82px (72 cell + 10 gap, see grid/config.ts) — dragging the
  // east handle 2 pitches right should grow w1 from w:4 to w:6.
  await act(async () => {
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 0,
        clientY: 0,
      }),
    );
  });
  await act(async () => {
    root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: 164,
        clientY: 0,
      }),
    );
  });
  await act(async () => {
    root.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  const saved = JSON.parse(storage.kv.get("widget_layout")!);
  // w1 grew in place — its col/row didn't move, only w.
  expect(saved.w1).toMatchObject({ col: 2, row: 2, w: 6, h: 3 });
  // w1 now spans col 2-7, so w2 (which sat at col 6) collided and reflow()
  // resettled it into the first open top-left slot (col 0, row 0 clears
  // w1's new col 2-7/row 2-4 span) — same gravity-compaction reflow() already
  // runs for a colliding drag, reused unmodified for resize. w2's own w/h
  // were never touched by this resize, only its position.
  expect(saved.w2).toMatchObject({ col: 0, row: 0, w: 2, h: 2 });
});

test("resizing a widget's west edge shrinks it and shifts its col, keeping the right edge fixed", async () => {
  storage.kv.set("widget_layout", JSON.stringify({ w1: { col: 2, row: 2, w: 4, h: 3, m: 0 } }));
  const { container } = render(
    React.createElement(Desktop, { widgets: { w1: Stub }, monitorIndex: 0, windowed: false }),
  );

  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  const handle = container.querySelector('[data-resize-handle="w"]') as HTMLElement;
  const root = container.querySelector(".wigl-desktop") as HTMLElement;

  // The west edge moves 1 pitch (82px) right, shrinking w1 from w:4 to w:3
  // while its right edge (col 2 + w 4 = 6) stays put: new col = 6 - 3 = 3.
  await act(async () => {
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 0, clientY: 0 }),
    );
  });
  await act(async () => {
    root.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 82, clientY: 0 }),
    );
  });
  await act(async () => {
    root.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  const saved = JSON.parse(storage.kv.get("widget_layout")!);
  expect(saved.w1).toMatchObject({ col: 3, row: 2, w: 3, h: 3 });
});
