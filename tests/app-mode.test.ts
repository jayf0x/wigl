import { describe, expect, test } from "bun:test";
import { oppositeMode, toggleModeLabel } from "../src/wigl/settings/appMode";

describe("oppositeMode", () => {
  test("windowed toggles to overlay", () => {
    expect(oppositeMode(true)).toBe("overlay");
  });

  test("overlay toggles to windowed", () => {
    expect(oppositeMode(false)).toBe("windowed");
  });
});

describe("toggleModeLabel", () => {
  test("labels the switch away from the current mode", () => {
    expect(toggleModeLabel(true)).toBe("Switch to desktop mode");
    expect(toggleModeLabel(false)).toBe("Switch to windowed mode");
  });
});
