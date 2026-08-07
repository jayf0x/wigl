// A markdown *tokenizer*, not an HTML generator. It exists because agent
// output is untrusted LLM text and `dangerouslySetInnerHTML` is banned
// app-wide (AGENTS.md) — every token here is handed to React as a string
// child, so escaping is never our problem. Keeping it separate from
// Markdown.tsx makes the parsing testable without a renderer
// (docs/principles.md's functional core) — see tests/markdown.test.ts.
//
// Scope is deliberately "what a coding agent actually emits": fences,
// headings, lists, quotes, rules, and inline code/emphasis/links. No tables,
// no footnotes, no HTML passthrough. A construct we don't parse degrades to
// its literal source text, which is readable — never to a crash.

export type Span =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "code"; lang: string; content: string }
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: Span[][] }
  | { kind: "quote"; spans: Span[] }
  | { kind: "rule" }
  | { kind: "para"; spans: Span[] };

// One alternation per inline construct, in precedence order — code first so
// `**not bold**` inside backticks stays literal.
// Emphasis delimiters must hug their text (`*a*`, never `2 * 3 * 4`) — the
// naive `\*[^*]+\*` turns arithmetic and glob patterns in agent output into
// italics, which is exactly the "broken formatting" this replaced.
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*(?![\s*])[^*\n]*[^\s*]\*\*)|(\*(?![\s*])[^*\n]*[^\s*]\*|_(?![\s_])[^_\n]*[^\s_]_)|(\[[^\]\n]*\]\([^)\s]+\))/g;

export const parseInline = (text: string): Span[] => {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > last) spans.push({ kind: "text", text: text.slice(last, m.index) });
    const [raw] = m;
    if (m[1]) spans.push({ kind: "code", text: raw.slice(1, -1) });
    else if (m[2]) spans.push({ kind: "strong", text: raw.slice(2, -2) });
    else if (m[3]) spans.push({ kind: "em", text: raw.slice(1, -1) });
    else {
      const split = raw.indexOf("](");
      spans.push({ kind: "link", text: raw.slice(1, split) || raw.slice(split + 2, -1), href: raw.slice(split + 2, -1) });
    }
    last = m.index + raw.length;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last) });
  return spans;
};

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^[-*+]\s+(.*)$/;
const ORDERED_RE = /^\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const RULE_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const FENCE_RE = /^```([\w-]*)\s*$/;

/** Streaming-safe: an unterminated fence (the common case mid-generation)
 * yields a code block with whatever has arrived so far rather than dumping
 * the rest of the message as literal backticks. */
export const parseBlocks = (text: string): Block[] => {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (para.length) blocks.push({ kind: "para", spans: parseInline(para.join(" ")) });
    if (quote.length) blocks.push({ kind: "quote", spans: parseInline(quote.join(" ")) });
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    para = [];
    quote = [];
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line.trim());
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      for (; i < lines.length && !FENCE_RE.test(lines[i].trim()); i++) body.push(lines[i]);
      blocks.push({ kind: "code", lang: fence[1], content: body.join("\n") });
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (RULE_RE.test(trimmed)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }
    const quoted = QUOTE_RE.exec(trimmed);
    if (quoted) {
      if (para.length || list) flush();
      quote.push(quoted[1]);
      continue;
    }
    const bullet = BULLET_RE.exec(trimmed);
    const ordered = ORDERED_RE.exec(trimmed);
    if (bullet || ordered) {
      if (para.length || quote.length) flush();
      const item = (bullet ?? ordered)?.[1] ?? "";
      if (list && list.ordered === Boolean(ordered)) list.items.push(item);
      else {
        if (list) flush();
        list = { ordered: Boolean(ordered), items: [item] };
      }
      continue;
    }
    if (quote.length || list) flush();
    para.push(trimmed);
  }
  flush();
  return blocks;
};
