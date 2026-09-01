// The Web Audio graph itself needs a real AudioContext (browser only) — the
// only pure bit worth a check is fxIsFlat, which gates the "effects on" dot
// and the reset button.
import { describe, expect, test } from "bun:test";
import { DEFAULT_FX, fxIsFlat } from "../audioGraph";

describe("fxIsFlat", () => {
  test("the default is flat", () => {
    expect(fxIsFlat(DEFAULT_FX)).toBe(true);
  });
  test("any non-zero band is not flat", () => {
    expect(fxIsFlat({ ...DEFAULT_FX, low: -3 })).toBe(false);
    expect(fxIsFlat({ ...DEFAULT_FX, reverb: 0.4 })).toBe(false);
    expect(fxIsFlat({ ...DEFAULT_FX, echo: 0.01 })).toBe(false);
  });
});
