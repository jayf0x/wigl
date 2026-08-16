import { autoPlace, collides, type GridItem, reflow } from "../src/wigl/grid/math";
import { describe, expect, test } from "bun:test";

describe("collides", () => {
  test("overlapping items collide", () => {
    const a: GridItem = { id: "a", col: 0, row: 0, w: 2, h: 2 };
    const b: GridItem = { id: "b", col: 1, row: 1, w: 2, h: 2 };
    expect(collides(a, b)).toBe(true);
  });

  test("adjacent items don't collide", () => {
    const a: GridItem = { id: "a", col: 0, row: 0, w: 2, h: 2 };
    const b: GridItem = { id: "b", col: 2, row: 0, w: 2, h: 2 };
    expect(collides(a, b)).toBe(false);
  });

  test("hidden items never collide", () => {
    const a: GridItem = { id: "a", col: 0, row: 0, w: 2, h: 2 };
    const b: GridItem = { id: "b", col: 0, row: 0, w: 2, h: 2, hidden: true };
    expect(collides(a, b)).toBe(false);
  });
});

describe("autoPlace", () => {
  test("places into the first free slot", () => {
    const placed: GridItem[] = [{ id: "a", col: 0, row: 0, w: 2, h: 2 }];
    expect(autoPlace(placed, 1, 1, 4)).toEqual({ col: 2, row: 0 });
  });

  test("wraps to next row when the item doesn't fit", () => {
    const placed: GridItem[] = [{ id: "a", col: 0, row: 0, w: 4, h: 1 }];
    expect(autoPlace(placed, 2, 1, 4)).toEqual({ col: 0, row: 1 });
  });
});

describe("reflow", () => {
  test("pushes a colliding item downward and settles it without overlap", () => {
    const moved: GridItem = { id: "moved", col: 0, row: 0, w: 2, h: 2 };
    const other: GridItem = { id: "other", col: 0, row: 0, w: 2, h: 2 };
    const items = [moved, other];
    reflow(items, moved, 4);
    expect(collides(moved, other)).toBe(false);
  });
});
