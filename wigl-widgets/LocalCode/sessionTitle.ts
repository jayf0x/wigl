// Deterministic (non-LLM) session titling from a session's first user
// message — see backlog.md's F11. Trimmed, in-widget port of the
// yake-ts + session-rename POC (github.com/.../session-rename, not
// published — small enough to own directly rather than add an unpublished
// dependency): YAKE keyword extraction (`yake-ts`, a real npm dep) plus a
// title-specific redundancy filter so near-duplicate n-grams ("fix flaky
// auth" / "flaky auth test") don't both land in one title.
//
// Why not show opencode's own model-generated title: dropped for quality
// (see useSessions.ts's defaultTitle comment) and it's a real
// prompt-injection surface — a real session on this machine ended up with
// a stored title containing raw `<|endoftext|><|im_start|>user` control
// tokens, verbatim, from adversarial input. This module only ever
// concatenates whole words pulled out of the input by YAKE, so there's no
// path for it to reproduce a control token or follow an embedded
// instruction.
import { extractKeywords } from "yake-ts";

// yake-ts doesn't export its own bundled English stopword set (English is
// just its internal default) — this is a separate, smaller concern anyway:
// not "what should YAKE ignore when scoring candidates" (yake-ts's own
// job), but "what counts as filler when judging whether one already-scored
// candidate phrase restates another" for this widget's redundancy filter
// below. YAKE candidates can legitimately contain a stopword mid-phrase
// ("couple of issues"), so this still needs its own filler list — a short
// hand-picked one is enough for that narrower job.
const FILLER_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "but",
  "with", "at", "by", "from", "as", "is", "are", "was", "were", "be",
  "been", "being", "this", "that", "these", "those", "it", "its", "i",
  "you", "he", "she", "we", "they", "my", "your", "our", "their", "not",
  "no", "so", "do", "does", "did", "can", "could", "will", "would",
  "should", "just", "please", "also", "really", "like", "thing", "things",
  "stuff", "issue", "issues", "problem", "problems", "question",
  "questions", "way", "ways", "something", "anything", "everything",
  "help",
]);

const words = (text: string): string[] => text.toLowerCase().split(/\s+/).filter(Boolean);

const meaningfulWords = (text: string): string[] => words(text).filter((w) => !FILLER_WORDS.has(w));

const jaccard = (a: string, b: string): number => {
  const aa = new Set(words(a));
  const bb = new Set(words(b));
  if (aa.size === 0 && bb.size === 0) return 0;
  let intersection = 0;
  for (const w of aa) if (bb.has(w)) intersection += 1;
  return intersection / new Set([...aa, ...bb]).size;
};

interface Candidate {
  text: string;
  score: number;
}

const isSubset = (a: string[], bSet: Set<string>): boolean => a.length > 0 && a.every((w) => bSet.has(w));

// Two candidates are redundant when one's meaningful words are a full
// subset of the other's — "resize handle bug" already says everything
// "handle bug" does, so keeping both just repeats "handle bug" in the
// rendered title — or when they otherwise overlap heavily by Jaccard
// similarity. Strict subset (not "mostly overlaps") avoids misclassifying
// unrelated phrases that happen to share one word ("love honey" vs. "eat
// yellow honey") as duplicates.
const isRedundant = (a: Candidate, b: Candidate): boolean => {
  const aWords = meaningfulWords(a.text);
  const bWords = meaningfulWords(b.text);
  if (isSubset(aWords, new Set(bWords)) || isSubset(bWords, new Set(aWords))) return true;
  return jaccard(a.text, b.text) >= 0.7;
};

// Of two redundant candidates, prefer the more informative (more
// meaningful words) one; ties broken by YAKE score (lower = better).
const preferred = (a: Candidate, b: Candidate): Candidate => {
  const diff = meaningfulWords(a.text).length - meaningfulWords(b.text).length;
  if (diff !== 0) return diff > 0 ? a : b;
  return a.score <= b.score ? a : b;
};

const dedupeCandidates = (candidates: Candidate[]): Candidate[] => {
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    const dupIndex = kept.findIndex((existing) => isRedundant(existing, candidate));
    if (dupIndex === -1) kept.push(candidate);
    else kept[dupIndex] = preferred(kept[dupIndex]!, candidate);
  }
  return kept;
};

const truncateToWord = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
};

const MAX_PHRASES = 3;
const MAX_LENGTH = 60;
const CANDIDATE_POOL_SIZE = 12;

/**
 * A session prompt sometimes opens with a leftover slash-command-looking
 * line (`/model llama3`) or other non-content noise typed at the very
 * start before the real ask — Composer.tsx treats `/` as plain literal
 * text (no real slash commands exist here), so this can genuinely show up
 * verbatim in a first message. Drop only a *leading* run of such lines —
 * `/` appearing mid-sentence ("fix the a/b test") is real content.
 */
const LEADING_COMMAND_LINE = /^\/\S+/;
export const stripPromptNoise = (text: string): string => {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && LEADING_COMMAND_LINE.test(lines[start]!.trim())) start += 1;
  return lines.slice(start).join("\n").trim();
};

/**
 * Deterministic keyword-phrase title from a chunk of text. Not every
 * prompt yields something — very short ("hey"), all-stopword, or
 * post-strip-empty input returns "".
 */
export const makeTitle = (text: string): string => {
  const trimmed = stripPromptNoise(text).replace(/\s+/g, " ").trim();
  if (!trimmed) return "";

  const keywords = extractKeywords(trimmed, { limit: CANDIDATE_POOL_SIZE, dedupeThreshold: 1 });
  if (keywords.length === 0) return "";

  const unique = dedupeCandidates(keywords.map((k) => ({ text: k.keyword, score: k.score })));

  // Greedy set-cover over meaningful words, not just pairwise
  // redundancy: short prompts produce many YAKE n-grams that are sliding
  // windows over the same handful of content words (e.g. "fix flaky
  // auth" / "flaky auth test" share 2 of 3 words but sit under the
  // pairwise Jaccard cutoff above), so a global "already said this" check
  // is what actually keeps a 3-phrase title from repeating a word.
  let emitted = 0;
  const outputWords: string[] = [];
  const usedWords = new Set<string>();
  for (const candidate of unique) {
    if (emitted >= MAX_PHRASES) break;

    const candidateWords = meaningfulWords(candidate.text);
    const newWordCount = candidateWords.filter((w) => !usedWords.has(w)).length;
    if (candidateWords.length === 0 || newWordCount / candidateWords.length <= 0.5) continue;
    for (const w of candidateWords) usedWords.add(w);

    // A candidate can pass the checks above yet still share a literal
    // word right at the join boundary once concatenated (e.g. "backlog
    // and fix" + "fix the resize" reads "...and fix fix the...") — drop
    // that leading duplicate word instead of rejecting the whole phrase.
    let phraseWords = candidate.text.split(" ");
    if (outputWords.length > 0 && phraseWords[0]!.toLowerCase() === outputWords.at(-1)!.toLowerCase()) {
      phraseWords = phraseWords.slice(1);
    }
    if (phraseWords.length === 0) continue;

    const next = [...outputWords, ...phraseWords].join(" ");
    if (next.length > MAX_LENGTH) {
      if (outputWords.length === 0) outputWords.push(...truncateToWord(candidate.text, MAX_LENGTH).split(" "));
      break;
    }
    outputWords.push(...phraseWords);
    emitted += 1;
  }

  return outputWords.join(" ");
};

/**
 * `#{{counter}} {{keywords}}`, e.g. "#132 resolve bug widgets" — the
 * counter is always present so a prompt too short/generic for YAKE to say
 * anything ("hey", "y", "ok thanks") still gets a stable, unique fallback
 * title instead of an empty one.
 */
export const formatAutoTitle = (counter: number, text: string): string => {
  const label = `#${counter}`;
  const title = makeTitle(text);
  return title ? `${label} ${title}` : label;
};
