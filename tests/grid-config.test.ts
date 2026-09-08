// applyGridOverrides mutates the shared TILING object in place — Settings >
// Grid writes a `wigl_grid` storage row and Desktop feeds it here live (no
// restart, grid math re-reads TILING per call). The sharp bit: `{}` is a
// genuine full reset, not a merge — every field, scalars and the nested
// `padding` object, must land back on the module-load snapshot. A naive
// `Object.assign(TILING, o)` would leave a previously-set `cell` in place.
// Context: the "applyGridOverrides" entry this replaces in tests/backlog.md.
import { applyGridOverrides, TILING } from "../src/wigl/grid/config";
import { afterEach, describe, expect, test } from "bun:test";

// Snapshot the real defaults once, before any test mutates them, so a failure
// mid-suite can't poison the rest of the run.
const DEFAULTS = {
  cell: TILING.cell,
  gap: TILING.gap,
  cols: TILING.cols,
  rows: TILING.rows,
  padding: { ...TILING.padding },
};

afterEach(() => applyGridOverrides({}));

describe("applyGridOverrides", () => {
  test("applies scalar and nested-padding overrides", () => {
    applyGridOverrides({ cell: 100, padding: { top: 5 } });
    expect(TILING.cell).toBe(100);
    expect(TILING.padding.top).toBe(5);
    // padding is replaced from defaults + the partial, not left half-stale
    expect(TILING.padding.right).toBe(DEFAULTS.padding.right);
  });

  test("`{}` is a full reset — every field back to the module-load default", () => {
    applyGridOverrides({ cell: 100, gap: 40, cols: 5, rows: 9, padding: { top: 5, left: 1 } });
    applyGridOverrides({});
    expect(TILING.cell).toBe(DEFAULTS.cell);
    expect(TILING.gap).toBe(DEFAULTS.gap);
    expect(TILING.cols).toBe(DEFAULTS.cols);
    expect(TILING.rows).toBe(DEFAULTS.rows);
    expect(TILING.padding).toEqual(DEFAULTS.padding);
  });

  test("rejects nonsense values (<=0 cell/cols, negative gap) and falls back to default", () => {
    applyGridOverrides({ cell: 0, gap: -3, cols: -1 });
    expect(TILING.cell).toBe(DEFAULTS.cell);
    expect(TILING.gap).toBe(DEFAULTS.gap);
    expect(TILING.cols).toBe(DEFAULTS.cols);
  });

  test("gap: 0 is valid (>= 0), unlike cell: 0", () => {
    applyGridOverrides({ gap: 0 });
    expect(TILING.gap).toBe(0);
  });
});
