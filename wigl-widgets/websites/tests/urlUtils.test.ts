// Pure unit tests for normalizeUrl — the only bit of real logic in this
// widget (everything else is thin React/iframe wiring, out of scope per
// AGENTS.md's testing policy).
import { describe, expect, test } from "bun:test";
import { normalizeUrl } from "../urlUtils";

describe("normalizeUrl", () => {
  test("prepends https:// to a bare domain", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });

  test("leaves an https:// URL untouched", () => {
    expect(normalizeUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  test("leaves an http:// URL untouched", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeUrl("  example.com  ")).toBe("https://example.com");
  });

  test("empty/whitespace-only input stays empty", () => {
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl("   ")).toBe("");
  });

  test("a host:port with no scheme still gets https:// prepended", () => {
    expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000");
  });
});
