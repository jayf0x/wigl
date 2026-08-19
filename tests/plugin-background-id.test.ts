// Pure-logic coverage for F11 half 2's reserved-id handling (see commit
// implementing it in git history). "background" is deliberately the
// opposite of "main"/"wigl": those two block a folder from ever loading,
// this one is a valid folder id that gets routed differently, never
// rejected — a regression here would either silently reject a background
// plugin (folded into RESERVED_PLUGIN_IDS by mistake) or silently start
// rejecting "main"/"wigl" again (BACKGROUND_PLUGIN_ID defined but the set
// itself touched by accident).
import { describe, expect, test } from "bun:test";
import { BACKGROUND_PLUGIN_ID, RESERVED_PLUGIN_IDS, resolvePluginConfig } from "../src/wigl/plugins/types";

describe("BACKGROUND_PLUGIN_ID", () => {
  test("is not itself a reserved id — a 'background' folder must be loadable", () => {
    expect(RESERVED_PLUGIN_IDS.has(BACKGROUND_PLUGIN_ID)).toBe(false);
  });

  test("main/wigl are still reserved and blocked", () => {
    expect(RESERVED_PLUGIN_IDS.has("main")).toBe(true);
    expect(RESERVED_PLUGIN_IDS.has("wigl")).toBe(true);
  });

  test("resolves through the normal plugin-config path like any other folder", () => {
    const config = resolvePluginConfig(BACKGROUND_PLUGIN_ID, null);
    expect(config.id).toBe("background");
    expect(config.entry).toBe(".wigl/index.js");
    expect(config.permissions).toEqual([]);
  });
});
