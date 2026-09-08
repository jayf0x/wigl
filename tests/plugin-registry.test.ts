// createPluginRequire is the whole plugin/host capability boundary — the
// only place a capability is handed out, so the only place one is withheld
// (registry.ts's own comment). Permission enforcement isn't a subsystem,
// it's this lookup, so it's exactly the "shared invariant everything depends
// on" the AGENTS.md testing bar is about. The e2e suite exercises it
// end-to-end through `widget:check`; this covers the gating logic directly.
import { createPluginRequire } from "../src/wigl/plugins/registry";
import { describe, expect, test } from "bun:test";

describe("createPluginRequire", () => {
  test("an ungated module resolves for any plugin", () => {
    const req = createPluginRequire("p", []);
    expect(typeof req("react")).toBe("object");
    expect(req("react/jsx-runtime")).toBeDefined();
  });

  test("a specifier the host doesn't provide throws, naming the plugin and spec", () => {
    const req = createPluginRequire("p", []);
    expect(() => req("date-fns")).toThrow(/plugin "p" imported "date-fns"/);
  });

  test("a member gated on a permission the plugin lacks becomes a thrower at the call site", () => {
    const utils = createPluginRequire("p", [])("@/wigl/utils");
    // cn (ungated formatting helper) still works…
    expect(typeof utils.cn).toBe("function");
    // …runCmd (gated on "command") is replaced by a thrower that names the
    // missing permission, rather than being silently absent.
    expect(() => utils.runCmd("ls", [])).toThrow(/"command" permission/);
  });

  test("granting the permission lets the gated member through unchanged", () => {
    const bare = createPluginRequire("p", [])("@/wigl/utils");
    const granted = createPluginRequire("p", ["command"])("@/wigl/utils");
    expect(granted.runCmd).not.toBe(bare.runCmd); // bare one is the thrower
    expect(typeof granted.runCmd).toBe("function");
  });

  test("hooks module: useStorage is wrapped (key-scoped) when storage is granted, a thrower when not", () => {
    const denied = createPluginRequire("p", [])("@/wigl/hooks");
    expect(() => denied.useStorage("k", 0)).toThrow(/"storage" permission/);

    const ok = createPluginRequire("p", ["storage"])("@/wigl/hooks");
    // a real function (the per-plugin key-prefixing wrapper), not the thrower
    expect(typeof ok.useStorage).toBe("function");
    expect(ok.useStorage.toString()).not.toMatch(/without the/);
  });

  test("each plugin gets its own view — denying one doesn't mutate the shared namespace", () => {
    const a = createPluginRequire("a", ["command"])("@/wigl/utils");
    const b = createPluginRequire("b", [])("@/wigl/utils");
    expect(typeof a.runCmd).toBe("function");
    expect(() => b.runCmd("ls", [])).toThrow();
    // a's still fine after b's view was built
    expect(typeof a.runCmd).toBe("function");
  });
});
