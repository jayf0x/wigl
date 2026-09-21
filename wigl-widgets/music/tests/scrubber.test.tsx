// The scrubber's power contract: while playing it costs one coarse JS tick
// (SCRUBBER_TICK_MS), never a per-frame rAF loop; the bar is moved by a CSS
// transition toward an optimistic target, and an `api` identity change (which
// happens on nearly every state update) must not restart the tick.
import * as React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { SCRUBBER_TICK_MS } from "../music.config";

// `@/…` only resolves through the host module registry at runtime, so stub
// the two host modules Scrubber imports.
mock.module("@/components/ui/button", () => ({
  Button: (p: React.ComponentProps<"button">) => <button {...p} />,
}));
mock.module("@/wigl/utils", () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(" ") }));
const { Scrubber } = await import("../components/NowPlaying/Scrubber");

const makeApi = (over: Record<string, unknown> = {}) =>
  ({
    now: { title: "t", playing: true, isRadio: false, elapsed: 10, duration: 200 },
    playbackSpeed: 1,
    getProgress: () => ({ position: 10, duration: 200, playbackSpeed: 1 }),
    seek: () => {},
    setPlaybackSpeed: () => {},
    ...over,
  }) as never;

const fill = (c: HTMLElement) => c.querySelector("span.origin-left") as HTMLElement;

const spies: { mockRestore: () => void }[] = [];
afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

describe("Scrubber", () => {
  test("no requestAnimationFrame loop; one interval at the configured tick", () => {
    const raf = spyOn(globalThis, "requestAnimationFrame");
    const si = spyOn(globalThis, "setInterval");
    spies.push(raf, si);
    const { unmount } = render(<Scrubber api={makeApi()} />);
    expect(raf).not.toHaveBeenCalled();
    const ticks = si.mock.calls.filter((c) => c[1] === SCRUBBER_TICK_MS);
    expect(ticks.length).toBe(1);
    unmount();
  });

  test("bar targets where the clock will be one tick ahead, via a CSS transition", () => {
    const { container, unmount } = render(<Scrubber api={makeApi()} />);
    const el = fill(container);
    // (10s + one tick at 1x) / 200s
    const m = /scaleX\(([\d.]+)\)/.exec(el.style.transform);
    expect(Number(m?.[1])).toBeCloseTo((10 + SCRUBBER_TICK_MS / 1000) / 200, 3);
    expect(el.style.transition).toMatch(/transform \d+ms linear/);
    // Longer than the tick, so a late tick can't leave the bar stalled.
    expect(parseInt(/(\d+)ms/.exec(el.style.transition)![1]!)).toBeGreaterThan(SCRUBBER_TICK_MS);
    unmount();
  });

  test("a new api identity doesn't restart the interval", () => {
    const si = spyOn(globalThis, "setInterval");
    const ci = spyOn(globalThis, "clearInterval");
    spies.push(si, ci);
    const { rerender, unmount } = render(<Scrubber api={makeApi()} />);
    const started = si.mock.calls.filter((c) => c[1] === SCRUBBER_TICK_MS).length;
    const cleared = ci.mock.calls.length;
    for (let i = 0; i < 5; i++) rerender(<Scrubber api={makeApi()} />);
    expect(si.mock.calls.filter((c) => c[1] === SCRUBBER_TICK_MS).length).toBe(started);
    expect(ci.mock.calls.length).toBe(cleared);
    unmount();
    expect(ci.mock.calls.length).toBeGreaterThan(cleared); // and unmount does clear it
  });

  test("paused: no interval at all", () => {
    const si = spyOn(globalThis, "setInterval");
    spies.push(si);
    const api = makeApi({ now: { title: "t", playing: false, isRadio: false, elapsed: 10, duration: 200 } });
    const { unmount } = render(<Scrubber api={api} />);
    expect(si.mock.calls.filter((c) => c[1] === SCRUBBER_TICK_MS).length).toBe(0);
    unmount();
  });

  test("a tick advances the target with real time and reconciles a drift", async () => {
    let pos = 10;
    const api = makeApi({ getProgress: () => ({ position: pos, duration: 200, playbackSpeed: 1 }) });
    const { container, unmount } = render(<Scrubber api={api} />);
    pos = 60; // server says we're far ahead: snap, not glide
    await act(() => new Promise((r) => setTimeout(r, SCRUBBER_TICK_MS + 100)));
    const m = /scaleX\(([\d.]+)\)/.exec(fill(container).style.transform);
    expect(Number(m?.[1])).toBeCloseTo((60 + SCRUBBER_TICK_MS / 1000) / 200, 2);
    unmount();
  });
});
