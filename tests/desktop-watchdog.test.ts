// The drag/foreign-preview stuck-transaction watchdog is self-arming (no
// permanent interval — see src/wigl/Desktop/watchdog.ts), so the property
// that matters is "an open transaction is never left without a timer".
// Unit tier: a manual clock/scheduler covers every arm/disarm case. One
// integration test drives the real <Desktop> to prove the wiring — that a
// pointerdown actually arms it and an abandoned drag actually gets closed.
import * as React from "react";
import { act, render } from "@testing-library/react";
import { mockStorage } from "./mock-storage";
import { describe, expect, mock, test } from "bun:test";
import { createWatchdog } from "../src/wigl/Desktop/watchdog";

// Manual clock + scheduler: advance(ms) fires due timers in order.
const harness = (over: { active: () => boolean; stale: () => void }) => {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const wd = createWatchdog({
    isActive: over.active,
    onStale: over.stale,
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      t = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    t = end;
  };
  return { wd, advance, pending: () => timers.size };
};

describe("createWatchdog", () => {
  test("idle: no timer exists until something touches it", () => {
    const h = harness({ active: () => false, stale: () => {} });
    expect(h.pending()).toBe(0);
    h.advance(10_000);
    expect(h.pending()).toBe(0);
  });

  test("a normal gesture that ends disarms itself and never fires", () => {
    let open = true;
    let staled = 0;
    const h = harness({ active: () => open, stale: () => staled++ });
    h.wd.touch();
    h.advance(600); // still moving, well inside staleMs
    h.wd.touch();
    open = false; // pointerup
    h.advance(5_000);
    expect(staled).toBe(0);
    expect(h.pending()).toBe(0); // disarmed by observing !isActive
  });

  test("a gesture that goes quiet is force-closed after ~1s, then the timer stops", () => {
    let open = true;
    let staled = 0;
    const h = harness({
      active: () => open,
      stale: () => {
        staled++;
        open = false; // what abandonDrag/clearForeign do
      },
    });
    h.wd.touch();
    h.advance(900);
    expect(staled).toBe(0); // 900ms of silence: not yet
    h.advance(600);
    expect(staled).toBe(1);
    h.advance(5_000);
    expect(staled).toBe(1);
    expect(h.pending()).toBe(0);
  });

  test("continuous progress keeps a long gesture alive past staleMs", () => {
    let staled = 0;
    const h = harness({ active: () => true, stale: () => staled++ });
    for (let i = 0; i < 20; i++) {
      h.wd.touch(); // a pointermove every 100ms for 2s
      h.advance(100);
    }
    expect(staled).toBe(0);
  });

  test("re-arms after having disarmed: a second gesture is watched too", () => {
    let open = true;
    let staled = 0;
    const h = harness({
      active: () => open,
      stale: () => {
        staled++;
        open = false;
      },
    });
    h.wd.touch();
    open = false;
    h.advance(1_000); // first gesture ended cleanly; timer disarmed
    expect(h.pending()).toBe(0);
    open = true; // second gesture starts and immediately gets stuck
    h.wd.touch();
    h.advance(1_500);
    expect(staled).toBe(1);
  });

  test("drag and foreign preview both open: one stale-close clears both", () => {
    const open = { drag: true, foreign: true };
    let staled = 0;
    const h = harness({
      active: () => open.drag || open.foreign,
      stale: () => {
        staled++;
        open.drag = open.foreign = false;
      },
    });
    h.wd.touch();
    h.advance(1_500);
    expect(staled).toBe(1);
    expect(h.pending()).toBe(0);
  });

  test("if a stale-close leaves something open, it keeps watching (and closes again)", () => {
    let staled = 0;
    const h = harness({ active: () => true, stale: () => staled++ });
    h.wd.touch();
    h.advance(3_000);
    expect(staled).toBeGreaterThan(1);
    expect(h.pending()).toBe(1);
  });

  test("dispose cancels the timer; touch after dispose arms a fresh one (StrictMode remount)", () => {
    const h = harness({ active: () => true, stale: () => {} });
    h.wd.touch();
    expect(h.pending()).toBe(1);
    h.wd.dispose();
    expect(h.pending()).toBe(0);
    h.wd.touch();
    expect(h.pending()).toBe(1);
  });

  test("touching repeatedly never stacks timers", () => {
    const h = harness({ active: () => true, stale: () => {} });
    for (let i = 0; i < 50; i++) h.wd.touch();
    expect(h.pending()).toBe(1);
  });

  test("an untouched transaction is not watched — every start path must call touch()", () => {
    // isActive true with no touch(): the timer was never armed, so nothing
    // fires. This pins the contract; the integration tests cover the real
    // start paths (drag pointerdown, incoming preview).
    let staled = 0;
    const h = harness({ active: () => true, stale: () => staled++ });
    h.advance(5_000);
    expect(staled).toBe(0);
    expect(h.pending()).toBe(0);
  });
});

// --- integration: real <Desktop> ------------------------------------------

const storage = mockStorage();
storage.kv.set("widget_layout", JSON.stringify({ w1: { col: 0, row: 0, m: 0 } }));

const dragActive: boolean[] = [];
mock.module("@tauri-apps/api/core", () => {
  const actual = require("@tauri-apps/api/core");
  return {
    ...actual,
    invoke: async (cmd: string, args?: { active?: boolean }) => {
      if (cmd === "set_drag_active") dragActive.push(!!args?.active);
      return undefined;
    },
  };
});
mock.module("@tauri-apps/api/window", () => ({
  availableMonitors: async () => [
    { name: "0", position: { x: 0, y: 0 }, size: { width: 1000, height: 800 }, scaleFactor: 1 },
  ],
}));

const { Desktop } = await import("../src/wigl/Desktop");
const Handle = () => React.createElement("div", { "data-drag-handle": true, "data-testid": "handle" });
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

const down = (el: HTMLElement) =>
  el.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 50, clientY: 50, screenX: 50, screenY: 50 }),
  );
const move = (el: HTMLElement, x: number) =>
  el.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: x, clientY: 60, screenX: x, screenY: 60 }),
  );

describe("<Desktop> watchdog wiring", () => {
  test("a foreign preview whose drop/leave never arrives is cleared; refreshed previews keep it alive", async () => {
    const { emit } = await import("@tauri-apps/api/event");
    const { container, unmount } = render(
      React.createElement(Desktop, { widgets: { w1: Handle }, monitorIndex: 0, windowed: false }),
    );
    await wait(30);
    const ghost = container.querySelector(".wigl-ghost") as HTMLElement;
    const preview = () =>
      act(async () => void (await emit("wigl-preview", { id: "other", to: 0, col: 4, row: 2, w: 3, h: 4, cx: 200, cy: 200 })));

    await preview();
    expect(ghost.style.opacity).toBe("1");
    // Previews keep arriving for longer than staleMs: stays open.
    for (let i = 0; i < 4; i++) {
      await wait(400);
      await preview();
    }
    expect(ghost.style.opacity).toBe("1");
    // Then the source monitor's messages stop (lost wigl-drop): force-closed.
    await wait(1_500);
    expect(ghost.style.opacity).toBe("0");
    unmount();
  }, 10_000);

  test("a drag that never gets a pointerup is abandoned; an actively moving one is not", async () => {
    const { container, unmount } = render(
      React.createElement(Desktop, { widgets: { w1: Handle }, monitorIndex: 0, windowed: false }),
    );
    await wait(30);
    dragActive.length = 0; // Desktop sends its own set_drag_active(false) on mount
    const handle = container.querySelector('[data-testid="handle"]') as HTMLElement;
    const root = container.querySelector(".wigl-desktop") as HTMLElement;

    await act(async () => void down(handle));
    expect(dragActive).toEqual([true]);

    // Keep moving for ~1.5s — longer than staleMs — the drag must survive.
    for (let x = 60; x < 60 + 5 * 6; x += 6) {
      await wait(300);
      await act(async () => void move(root, x));
    }
    expect(dragActive).toEqual([true]);

    // Now go silent: abandoned within staleMs + one tick, set_drag_active(false) sent.
    await wait(1_500);
    expect(dragActive).toEqual([true, false]);
    unmount();
  }, 10_000);
});
