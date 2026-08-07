// Pure, instant — the composer's whole "is this a command or is this text"
// decision lives in commands.ts precisely so it can be tested without a
// webview. Run with `bun test wigl-widgets/LocalCode/tests/commands.test.ts`.
import { describe, expect, test } from "bun:test";
import { filterOptions, parseCommand, resolveCommand } from "../commands";

describe("parseCommand", () => {
  test("bare slash opens the command palette", () => {
    expect(parseCommand("/")).toEqual({ name: "", query: "", hasArg: false });
  });

  test("name only, no argument yet", () => {
    expect(parseCommand("/mod")).toEqual({ name: "mod", query: "", hasArg: false });
  });

  test("space after the name switches to argument mode", () => {
    expect(parseCommand("/model ")).toEqual({ name: "model", query: "", hasArg: true });
    expect(parseCommand("/model qwen")).toEqual({ name: "model", query: "qwen", hasArg: true });
  });

  test("a path or slash mid-prose is not a command", () => {
    expect(parseCommand("read /tmp/foo")).toBeNull();
    expect(parseCommand("/model\nand then do the thing")).toBeNull();
  });
});

describe("resolveCommand", () => {
  test("unique prefix resolves, empty and unknown do not", () => {
    expect(resolveCommand("mo")?.name).toBe("model");
    expect(resolveCommand("think")?.name).toBe("think");
    expect(resolveCommand("")).toBeNull();
    expect(resolveCommand("zz")).toBeNull();
  });
});

describe("filterOptions", () => {
  const opts = [
    { value: "ollama/qwen3.5:9b", label: "qwen3.5:9b" },
    { value: "ollama/smollm:135m", label: "smollm:135m" },
    { value: "ollama/qwen3.5:0.8b", label: "qwen3.5:0.8b" },
  ];

  test("empty query keeps everything in order", () => {
    expect(filterOptions(opts, "  ")).toEqual(opts);
  });

  test("prefix matches rank above mid-string matches", () => {
    expect(filterOptions(opts, "qwen").map((o) => o.label)).toEqual(["qwen3.5:9b", "qwen3.5:0.8b"]);
    // "ollama/" only matches on `value`, so every entry is a prefix hit.
    expect(filterOptions(opts, "135m").map((o) => o.label)).toEqual(["smollm:135m"]);
  });
});
