// Text-selection leak while dragging/resizing (bug report: "solved before
// for extreme cases [commit 49e8765's .dragging CSS rule + upfront
// removeAllRanges()], but still occurs more subtle[ly]"). Neither of those
// only covers the *moment* the gesture starts — a selection that forms
// later, mid-gesture, from whatever actually causes it (a native drag-to-
// select re-evaluating a later pointermove before React's class update has
// committed, a widget's own editor extending its own selection via the
// Selection API) was never cleared again. Desktop.tsx now clears any
// selection on every `selectionchange` for as long as a drag or resize is
// live, which is agnostic to *why* one appeared. Covered here: it fires
// mid-gesture (not just at the start), it's scoped to the gesture (leaves
// ordinary selection alone before/after), and both drag and resize arm it.
import * as React from "react";
import { act, render } from "@testing-library/react";
import { mockStorage } from "./mock-storage";
import { afterAll, expect, mock, test } from "bun:test";

const storage = mockStorage();
storage.kv.set(
  "widget_layout",
  JSON.stringify({ w1: { col: 0, row: 0, m: 0 }, w2: { col: 6, row: 0, m: 0 } }),
);

mock.module("@tauri-apps/api/core", () => {
  const actual = require("@tauri-apps/api/core");
  return { ...actual, invoke: async () => undefined };
});
mock.module("@tauri-apps/api/window", () => ({
  availableMonitors: async () => [{ name: "0", position: { x: 0, y: 0 }, size: { width: 1000, height: 800 }, scaleFactor: 1 }],
}));

const { Desktop } = await import("../src/wigl/Desktop");

// A widget whose body is real selectable text — standing in for the content
// of some other widget the drag flies over.
const Texty = () =>
  React.createElement("div", { "data-drag-handle": true, "data-testid": "handle" }, "grip") &&
  React.createElement(React.Fragment, null, [
    React.createElement("div", { "data-drag-handle": true, "data-testid": "handle", key: "h" }, "grip"),
    React.createElement("p", { "data-testid": "text", key: "t" }, "select me if you can"),
  ]);

afterAll(() => storage.restore());

// Simulates "a selection appeared" — happy-dom's Selection/Range support is
// real enough for addRange + a manual selectionchange dispatch (jsdom/happy-
// dom don't fire selectionchange on their own from DOM mutation the way a
// browser would), which is exactly the granularity this fix cares about: it
// reacts to the event, not to how the selection got there.
const fakeSelect = (node: Node) => {
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
};

test("a selection that appears mid-drag is cleared, not just one at drag-start", async () => {
  const { container, unmount } = render(
    React.createElement(Desktop, { widgets: { w1: Texty, w2: Texty }, monitorIndex: 0, windowed: false }),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));

  const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
  const text = container.querySelectorAll('[data-testid="text"]')[1] as HTMLElement; // w2's

  await act(async () => {
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10, screenX: 10, screenY: 10 }),
    );
  });

  // Not the drag-start clear — a selection forming well after pointerdown,
  // the "subtle" case the upfront removeAllRanges() never touches.
  await act(async () => fakeSelect(text));
  expect(window.getSelection()!.rangeCount).toBe(0);

  // And again, later in the same gesture — not a one-shot listener.
  await act(async () => fakeSelect(text));
  expect(window.getSelection()!.rangeCount).toBe(0);

  // Leaving the drag "live" would keep the listener armed for every test
  // that runs after this one in the same file (a real app only ever has one
  // Desktop mounted; unmount is the equivalent of the gesture actually ending).
  unmount();
});

test("outside a drag/resize, selectionchange is left alone", async () => {
  const { container, unmount } = render(
    React.createElement(Desktop, { widgets: { w1: Texty, w2: Texty }, monitorIndex: 0, windowed: false }),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  const text = container.querySelector('[data-testid="text"]') as HTMLElement;

  await act(async () => fakeSelect(text));
  expect(window.getSelection()!.rangeCount).toBe(1); // untouched: no gesture running
  window.getSelection()!.removeAllRanges();
  unmount();
});

test("the listener detaches on drop — a selection made right after isn't clobbered", async () => {
  const { container, unmount } = render(
    React.createElement(Desktop, { widgets: { w1: Texty, w2: Texty }, monitorIndex: 0, windowed: false }),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));

  const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
  const root = container.querySelector(".wigl-desktop") as HTMLElement;
  const text = container.querySelector('[data-testid="text"]') as HTMLElement;

  await act(async () => {
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10, screenX: 10, screenY: 10 }),
    );
  });
  await act(async () => {
    root.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  });

  await act(async () => fakeSelect(text));
  expect(window.getSelection()!.rangeCount).toBe(1); // drag is over: normal selection works again
  window.getSelection()!.removeAllRanges();
  unmount();
});

test("a resize (not a drag) arms the same clearing", async () => {
  const { container, unmount } = render(
    React.createElement(Desktop, { widgets: { w1: Texty, w2: Texty }, monitorIndex: 0, windowed: false }),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));

  const edge = container.querySelector('[data-resize-handle="e"]') as HTMLElement;
  const text = container.querySelectorAll('[data-testid="text"]')[1] as HTMLElement;

  await act(async () => {
    edge.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 90, clientY: 40, screenX: 90, screenY: 40 }),
    );
  });

  await act(async () => fakeSelect(text));
  expect(window.getSelection()!.rangeCount).toBe(0);
  unmount();
});
