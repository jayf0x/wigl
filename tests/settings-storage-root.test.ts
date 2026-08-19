// storageRoot() is the ordering-sensitive part of F13 (backlog.md):
// dbPath()/pluginsDir() must resolve to a storage.root override when one's
// set, and fall back to the OS's app_data_dir() otherwise. Mocks
// @tauri-apps/api/core + path so this runs with no real Tauri IPC.
import { mock } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => undefined,
}));
mock.module("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/default/appdata",
  join: async (...parts: string[]) => parts.join("/"),
}));

import { afterAll, describe, expect, test } from "bun:test";
import { setConfigOverride, storageRoot } from "../src/wigl/settings/config";

describe("storageRoot", () => {
  afterAll(() => mock.restore());

  test("falls back to appDataDir() with no override", async () => {
    expect(await storageRoot()).toBe("/default/appdata");
  });

  test("uses the storage.root override once one's set", async () => {
    await setConfigOverride("storage", { root: "/custom/root" });
    expect(await storageRoot()).toBe("/custom/root");
  });

  test("clearing the override falls back to appDataDir() again", async () => {
    await setConfigOverride("storage", {});
    expect(await storageRoot()).toBe("/default/appdata");
  });
});
