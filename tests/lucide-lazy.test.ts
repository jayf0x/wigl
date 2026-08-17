import { describe, expect, test } from "bun:test";
import { lucideLazy } from "../src/wigl/plugins/lucide-lazy";

describe("lucideLazy", () => {
  test("resolves a plain icon name to a component", () => {
    expect(lucideLazy.ChevronDown).toBeDefined();
  });

  test("resolves the 'Icon'-suffixed alias to the same component", () => {
    expect(lucideLazy.ChevronDownIcon).toBe(lucideLazy.ChevronDown);
  });

  test("returns undefined for an unknown name", () => {
    expect(lucideLazy.NotARealIconName).toBeUndefined();
  });

  test("repeated access returns the same cached wrapper, not a fresh one", () => {
    const first = lucideLazy.ChevronDown;
    const second = lucideLazy.ChevronDown;
    expect(first).toBe(second);
  });
});
