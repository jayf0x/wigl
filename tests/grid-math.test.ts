import {
  autoPlace,
  colToPx,
  collides,
  colsForWidth,
  type GridItem,
  pxToCol,
  reflow,
  repack,
  settle,
} from "../src/wigl/grid/math";
import { TILING } from "../src/wigl/grid/config";
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

  test("leaves items the collision cascade never touched exactly where they were", () => {
    const moved: GridItem = { id: "moved", col: 0, row: 0, w: 2, h: 2 };
    const bystander: GridItem = { id: "bystander", col: 6, row: 6, w: 2, h: 2 };
    reflow([moved, bystander], moved, 12);
    expect(bystander).toMatchObject({ col: 6, row: 6 });
  });
});

describe("settle", () => {
  test("de-overlaps every item, order-independent", () => {
    const a: GridItem = { id: "a", col: 0, row: 0, w: 2, h: 2 };
    const b: GridItem = { id: "b", col: 0, row: 0, w: 2, h: 2 };
    const c: GridItem = { id: "c", col: 1, row: 1, w: 2, h: 2 };
    const items = [a, b, c];
    settle(items, 6);
    for (const [x, y] of [
      [a, b],
      [a, c],
      [b, c],
    ] as const) {
      expect(collides(x, y)).toBe(false);
    }
  });

  test("hidden items are ignored and keep their stored spot", () => {
    const shown: GridItem = { id: "shown", col: 0, row: 0, w: 2, h: 2 };
    const hidden: GridItem = { id: "hidden", col: 0, row: 0, w: 2, h: 2, hidden: true };
    settle([shown, hidden], 6);
    expect(hidden).toMatchObject({ col: 0, row: 0 });
    expect(shown).toMatchObject({ col: 0, row: 0 });
  });
});

describe("repack", () => {
  test("pulls a lone item that drifted off toward 0,0 (unlike settle)", () => {
    const stray: GridItem = { id: "stray", col: 3, row: 99, w: 2, h: 2 };
    repack([stray], 12);
    expect(stray).toMatchObject({ col: 0, row: 0 });
  });

  test("does not move hidden items", () => {
    const hidden: GridItem = { id: "hidden", col: 4, row: 40, w: 2, h: 2, hidden: true };
    repack([hidden], 12);
    expect(hidden).toMatchObject({ col: 4, row: 40 });
  });

  test("compacts several items reading-order first-fit", () => {
    const a: GridItem = { id: "a", col: 5, row: 5, w: 2, h: 2 };
    const b: GridItem = { id: "b", col: 8, row: 9, w: 2, h: 2 };
    repack([a, b], 12);
    expect(a).toMatchObject({ col: 0, row: 0 });
    expect(b).toMatchObject({ col: 2, row: 0 });
  });
});

describe("colsForWidth + px round-trip", () => {
  test("colsForWidth grows with available width and never drops below 1", () => {
    expect(colsForWidth(0)).toBe(1);
    const narrow = colsForWidth(400);
    const wide = colsForWidth(1600);
    expect(wide).toBeGreaterThan(narrow);
  });

  test("pxToCol(colToPx(n)) === n for every column in a realistic range", () => {
    for (let c = 0; c < 30; c++) expect(pxToCol(colToPx(c))).toBe(c);
  });

  test("colsForWidth honors a fixed TILING.cols override", () => {
    const original = TILING.cols;
    TILING.cols = 7;
    try {
      expect(colsForWidth(99999)).toBe(7);
    } finally {
      TILING.cols = original;
    }
  });
});
