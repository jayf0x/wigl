// useAnchorField's wakeField `force` param (Desktop.tsx uses it to keep the
// grid visible for as long as Settings is open, regardless of the user's own
// field.show preference — customizing the grid without seeing it defeats the
// point). Covered here as a pure hook test: `force` bypasses every value of
// field.show including "never", and a later plain (non-forced) call reliably
// reverts to whatever field.show actually says — not "on" forever once
// forced, which the naive `if (show === "never") return` this replaced would
// have produced (it never turns anything off once show === "never", since it
// never runs the toggle at all in that mode).
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { useAnchorField } from "../src/wigl/Desktop/useAnchorField";
import { TILING } from "../src/wigl/grid/config";

const originalShow = TILING.field.show;
afterEach(() => {
  TILING.field.show = originalShow;
});

// The hook only touches fieldRef.current if something has mounted an <svg>
// there (see setGhostCell/wakeField) — attach a real element by hand so the
// classList assertions below have something to read, without rendering the
// whole <Desktop> tree.
const setup = () => {
  const { result } = renderHook(() => useAnchorField());
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  result.current.fieldRef.current = svg;
  return { result, svg };
};

describe("useAnchorField's wakeField", () => {
  test("force shows the grid even when field.show is \"never\"", () => {
    TILING.field.show = "never";
    const { result, svg } = setup();
    result.current.wakeField(true, true);
    expect(svg.classList.contains("active")).toBe(true);
  });

  test("a plain call afterward reverts to field.show, it doesn't stay forced on", () => {
    TILING.field.show = "never";
    const { result, svg } = setup();
    result.current.wakeField(true, true); // e.g. Settings opens
    result.current.wakeField(false); // Settings closes
    expect(svg.classList.contains("active")).toBe(false);
  });

  test('reverting when field.show is "always" leaves it on, same as before Settings opened', () => {
    TILING.field.show = "always";
    const { result, svg } = setup();
    result.current.wakeField(true, true);
    result.current.wakeField(false);
    expect(svg.classList.contains("active")).toBe(true);
  });

  test("ordinary drag on/off is unaffected by the force param existing", () => {
    TILING.field.show = "drag";
    const { result, svg } = setup();
    result.current.wakeField(true);
    expect(svg.classList.contains("active")).toBe(true);
    result.current.wakeField(false);
    expect(svg.classList.contains("active")).toBe(false);
  });
});
