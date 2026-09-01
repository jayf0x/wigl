// The Web Audio graph itself needs a real AudioContext (browser only). The
// pure bits worth checking: the flat/active predicates that gate the "effects
// on" dot + reset button, and `normalizeFx` — it has to migrate the legacy
// `{low,mid,high,reverb,echo}` storage blob to the 4-band `FxState` without
// throwing or losing the user's EQ.
import { describe, expect, test } from "bun:test";
import { BAND_COUNT, DEFAULT_FX, fxIsActive, fxIsFlat, normalizeFx } from "../audioGraph";

describe("fxIsFlat / fxIsActive", () => {
  test("the default is flat and inactive", () => {
    expect(fxIsFlat(DEFAULT_FX)).toBe(true);
    expect(fxIsActive(DEFAULT_FX)).toBe(false);
  });
  test("any non-zero band or reverb is not flat", () => {
    expect(fxIsFlat({ ...DEFAULT_FX, bands: [-3, 0, 0, 0] })).toBe(false);
    expect(fxIsFlat({ ...DEFAULT_FX, reverb: 0.4 })).toBe(false);
  });
  test("bypass makes a non-flat chain inactive but stays non-flat", () => {
    const fx = { bands: [4, 0, 0, 0], reverb: 0, bypass: true };
    expect(fxIsFlat(fx)).toBe(false);
    expect(fxIsActive(fx)).toBe(false);
  });
});

describe("normalizeFx", () => {
  test("passes a valid current-shape value through, clamped", () => {
    const fx = normalizeFx({ bands: [99, -99, 2, -2], reverb: 5, bypass: true });
    expect(fx.bands).toEqual([12, -12, 2, -2]);
    expect(fx.reverb).toBe(1);
    expect(fx.bypass).toBe(true);
  });
  test("migrates the legacy low/mid/high/reverb/echo shape", () => {
    const fx = normalizeFx({ low: -6, mid: 3, high: 9, reverb: 0.5, echo: 0.9 });
    expect(fx.bands).toEqual([-6, 3, 3, 9]);
    expect(fx.reverb).toBe(0.5);
    expect(fx.bypass).toBe(false);
    expect("echo" in fx).toBe(false);
  });
  test("garbage in → the default, never a throw", () => {
    for (const bad of [null, undefined, 42, "x", [], {}]) {
      const fx = normalizeFx(bad);
      expect(fx.bands).toHaveLength(BAND_COUNT);
      expect(fxIsFlat(fx)).toBe(true);
    }
  });
});
