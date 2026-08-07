// Pure and instant — agent output formatting was a reported defect ("broken
// agent responses formatting"), so the block/inline rules get a real check.
import { describe, expect, test } from "bun:test";
import { parseBlocks, parseInline } from "../markdown";

describe("parseBlocks", () => {
  test("fences win over inline rules and keep their language", () => {
    const [block] = parseBlocks("```ts\nconst a = **not bold**;\n```");
    expect(block).toEqual({ kind: "code", lang: "ts", content: "const a = **not bold**;" });
  });

  test("an unterminated fence (mid-stream) still renders as code", () => {
    expect(parseBlocks("```\nhalf a f")).toEqual([{ kind: "code", lang: "", content: "half a f" }]);
  });

  test("headings, lists and quotes separate without a blank line", () => {
    const kinds = parseBlocks("# Title\n- one\n- two\n> note\ntext").map((b) => b.kind);
    expect(kinds).toEqual(["heading", "list", "quote", "para"]);
  });

  test("consecutive bullets collapse into one list, ordered starts a new one", () => {
    const blocks = parseBlocks("- a\n- b\n1. c");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
  });
});

describe("parseInline", () => {
  test("code beats emphasis, links keep their href", () => {
    expect(parseInline("`**x**`")).toEqual([{ kind: "code", text: "**x**" }]);
    expect(parseInline("see [docs](http://x.dev)")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "docs", href: "http://x.dev" },
    ]);
  });

  test("plain text passes through untouched", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
  });
});
