// Pure helpers. `arrayMove` is the queue drag-reorder reducer (P0.5, commit
// 6cbed6d area) split out of the DOM so the relative-shift math — which has to
// match MA `player_queues/move_item` — is checkable without a webview.
import { describe, expect, test } from "bun:test";
import { arrayMove } from "../util";

describe("arrayMove", () => {
  const l = ["a", "b", "c", "d"];
  test("moves down by a positive shift", () => {
    expect(arrayMove(l, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
  test("moves up by a negative shift", () => {
    expect(arrayMove(l, 3, -2)).toEqual(["a", "d", "b", "c"]);
  });
  test("clamps past the ends instead of dropping items", () => {
    expect(arrayMove(l, 1, -9)).toEqual(["b", "a", "c", "d"]);
    expect(arrayMove(l, 1, 9)).toEqual(["a", "c", "d", "b"]);
  });
  test("no-ops on zero shift, out-of-range index, or a resolved no-move", () => {
    expect(arrayMove(l, 1, 0)).toBe(l);
    expect(arrayMove(l, -1, 2)).toBe(l);
    expect(arrayMove(l, 9, 2)).toBe(l);
  });
  test("does not mutate the input", () => {
    const copy = [...l];
    arrayMove(l, 0, 3);
    expect(l).toEqual(copy);
  });
});
