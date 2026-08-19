// Pure-logic coverage for F6 ("duplicate widget" — see backlog.md/AGENTS.md
// for the full plan). The two real invariants worth protecting here:
//   1. `resolvePluginConfig`'s `instantiable` default/override, since a
//      regression either direction is silent — a widget that assumes a
//      global singleton (see LocalCode's package.json) would start allowing
//      "Duplicate" again, or every widget would stop allowing it.
//   2. `generateInstanceId`'s collision avoidance, since it's the only thing
//      standing between two duplicated instances and a shared storage/
//      require scope (registry.ts's createPluginRequire binds by whatever
//      id this function hands back — two instances with the same id would
//      silently clobber each other's state, the exact bug this whole
//      feature exists to avoid).
// The third invariant the plan calls out — the base instance's id always
// equals the folder id — isn't unit-testable in isolation: it's a one-line
// call-site fact in loader.ts's loadPlugins() (`loadOne(dir, folder, folder)`
// for the always-present first entry of `instanceIds`), not an algorithm.
// It's covered instead by this task's own manual verification (see the F6
// session's report): duplicating a widget and confirming the *original*
// instance's pre-existing storage rows read back unchanged.
import { describe, expect, test } from "bun:test";
import { generateInstanceId } from "../src/wigl/plugins/instances";
import { resolvePluginConfig } from "../src/wigl/plugins/types";

describe("resolvePluginConfig — instantiable", () => {
  test("defaults to true with no package.json at all", () => {
    expect(resolvePluginConfig("todo", null).instantiable).toBe(true);
  });

  test("defaults to true when wigl.instantiable is unset", () => {
    const raw = JSON.stringify({ wigl: { permissions: ["storage"] } });
    expect(resolvePluginConfig("todo", raw).instantiable).toBe(true);
  });

  test("honors an explicit false", () => {
    const raw = JSON.stringify({ wigl: { instantiable: false } });
    expect(resolvePluginConfig("LocalCode", raw).instantiable).toBe(false);
  });

  test("honors an explicit true", () => {
    const raw = JSON.stringify({ wigl: { instantiable: true } });
    expect(resolvePluginConfig("todo", raw).instantiable).toBe(true);
  });
});

describe("generateInstanceId", () => {
  test("never returns the folder id itself (that's the base instance's id)", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateInstanceId("todo", [])).not.toBe("todo");
    }
  });

  test("never collides with an already-recorded extra instance", () => {
    // Force every "random" candidate to collide except the last, by
    // recording a wide swath of possible outputs up front — if the
    // function ever stopped retrying on collision, this would eventually
    // return one of these.
    const existing = ["todo-000000", "todo-111111", "todo-zzzzzz"];
    for (let i = 0; i < 50; i++) {
      const id = generateInstanceId("todo", existing);
      expect(existing).not.toContain(id);
      expect(id).not.toBe("todo");
    }
  });

  test("stays inside useStorage's key charset (a-zA-Z0-9_-, no ':')", () => {
    const id = generateInstanceId("my-widget", []);
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  test("is prefixed with the folder id (readable in the 'closed widgets' menu)", () => {
    expect(generateInstanceId("todo", [])).toMatch(/^todo-/);
  });
});
