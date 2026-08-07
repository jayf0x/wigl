// Small local models spiral: they restate the same line, or the same phrase,
// until something stops them. Two independent answers to that, both pure and
// both here so they're testable without a model (tests/repetition.test.ts):
//
//   splitAtRepeat  — presentation. Fold the repeated tail out of the way so a
//                    spiral doesn't bury the part of the answer that was
//                    actually useful. (Idea lifted from the chatWidget in
//                    jayf0x.github.io, which solves the same problem.)
//   endsInLoop     — control. The turn is going nowhere; abort it instead of
//                    letting the GPU grind. Owner's framing: "stops when a
//                    phrase of N characters is repeated 3 times in a row".
//
// Deliberately separate: folding a duplicated line is cosmetic and can be
// wrong without cost, killing a turn can't — so the abort rule is the strict
// one (consecutive, character-level) and the fold is the loose one.

/** Splits at the first line that has already been seen. `repeated` is "" for
 * text that never repeats, which is the overwhelmingly common case. Blank
 * lines and pure punctuation are ignored as repeat candidates — a model
 * emitting two `---` rules isn't looping. */
export const splitAtRepeat = (text: string): { head: string; repeated: string } => {
  const lines = text.split("\n");
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].trim();
    if (key.length < 8) continue;
    if (seen.has(key)) return { head: lines.slice(0, i).join("\n").trimEnd(), repeated: lines.slice(i).join("\n") };
    seen.add(key);
  }
  return { head: text, repeated: "" };
};

export interface LoopOptions {
  /** Shortest phrase worth calling a loop — below this, repetition is normal
   * language ("the the", a list of identical bullets). */
  minChars?: number;
  /** How many back-to-back copies before it counts. */
  times?: number;
}

/** True when the text *ends* in the same phrase repeated back-to-back — the
 * only shape worth aborting on, since a repeat that stopped is a repeat the
 * model already recovered from. Scans candidate period lengths from the tail,
 * so it's O(text length × max period), bounded by only looking at the last
 * `minChars × times × 4` characters. */
export const endsInLoop = (text: string, { minChars = 24, times = 3 }: LoopOptions = {}): boolean => {
  const window = text.slice(-minChars * times * 4);
  const end = window.trimEnd().length;
  if (end < minChars * times) return false;
  for (let period = minChars; period <= Math.floor(end / times); period++) {
    const tail = window.slice(end - period, end);
    if (!tail.trim()) continue;
    let matches = true;
    for (let k = 1; k < times && matches; k++) {
      matches = window.slice(end - period * (k + 1), end - period * k) === tail;
    }
    if (matches) return true;
  }
  return false;
};
