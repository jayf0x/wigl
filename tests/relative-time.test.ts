// relativeTime is the pure formatter behind the useRelativeTime core hook
// (hooks/useRelativeTime.ts wraps it in one shared 60s interval). Branch
// logic on the m/h/d/w boundaries — worth pinning so a future "add months"
// or an off-by-one on a boundary doesn't slip through. `present` is
// injectable specifically so this needs no clock mocking.
import { relativeTime } from "../src/wigl/utils";
import { describe, expect, test } from "bun:test";

const NOW = 1_000_000_000; // fixed epoch-seconds "present"
const ago = (seconds: number) => relativeTime(NOW - seconds, NOW * 1000);

describe("relativeTime", () => {
  test('0 / falsy timestamp renders "?"', () => {
    expect(relativeTime(0, NOW * 1000)).toBe("?");
  });

  test("under an hour → minutes, floored, never below 1", () => {
    expect(ago(0)).toBe("1m");
    expect(ago(59)).toBe("1m");
    expect(ago(60)).toBe("1m");
    expect(ago(150)).toBe("2m");
    expect(ago(3599)).toBe("59m");
  });

  test("hour / day / week boundaries", () => {
    expect(ago(3600)).toBe("1h");
    expect(ago(86_399)).toBe("23h");
    expect(ago(86_400)).toBe("1d");
    expect(ago(604_799)).toBe("6d");
    expect(ago(604_800)).toBe("1w");
    expect(ago(604_800 * 5)).toBe("5w");
  });

  test("a future timestamp clamps to now, not a negative label", () => {
    expect(relativeTime(NOW + 10_000, NOW * 1000)).toBe("1m");
  });
});
