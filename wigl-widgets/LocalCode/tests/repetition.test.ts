// Pure and instant. `endsInLoop` gates a real side effect (aborting a live
// turn), so its false-positive cases matter as much as its true ones.
import { describe, expect, test } from "bun:test";
import { endsInLoop, splitAtRepeat } from "../repetition";

describe("splitAtRepeat", () => {
  test("text that never repeats comes back whole", () => {
    expect(splitAtRepeat("one line\nanother line")).toEqual({ head: "one line\nanother line", repeated: "" });
  });

  test("folds from the first already-seen line", () => {
    const { head, repeated } = splitAtRepeat("useful answer here\nlet me reconsider\nlet me reconsider");
    expect(head).toBe("useful answer here\nlet me reconsider");
    expect(repeated).toBe("let me reconsider");
  });

  test("short and blank lines are never repeat candidates", () => {
    const text = "- a\n\n- a\n\n- a";
    expect(splitAtRepeat(text).repeated).toBe("");
  });
});

describe("endsInLoop", () => {
  const phrase = "I should check the file again. ";

  test("three back-to-back copies at the end trip it", () => {
    expect(endsInLoop(`some real work first. ${phrase.repeat(3)}`)).toBe(true);
  });

  test("two copies do not", () => {
    expect(endsInLoop(`some real work first. ${phrase.repeat(2)}`)).toBe(false);
  });

  test("a repeat the model recovered from does not", () => {
    expect(endsInLoop(`${phrase.repeat(3)} and here is the actual answer, which is 4.`)).toBe(false);
  });

  test("ordinary prose does not, however long", () => {
    const prose = Array.from({ length: 40 }, (_, i) => `step ${i}: read the file and note what line ${i * 7} does.`);
    expect(endsInLoop(prose.join(" "))).toBe(false);
    expect(endsInLoop("")).toBe(false);
  });

  test("short repeated tokens are below the phrase floor", () => {
    expect(endsInLoop("ok. ok. ok. ok. ok. ok. ok. ok. ok. ok. ok. ok. ")).toBe(false);
  });
});
