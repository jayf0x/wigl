// DEMO — proves mock-storage.ts's `mock.module` swap actually intercepts
// `useStorage`'s real import of `../storage/client` and `@tauri-apps/api/event`,
// with no real sqlite3 or Tauri runtime involved. Not a real regression
// test for useStorage's own behavior (polling, write-ordering, etc.) —
// replace/delete once a real one exists (see tests-backlog.md).
//
// `mock.module` must run before the module under test is first imported —
// hence the dynamic `await import(...)` after calling mockStorage(),
// rather than a static top-level import.
import { act, renderHook, waitFor } from "@testing-library/react";
import { mockStorage } from "./mock-storage";
import { afterAll, describe, expect, test } from "bun:test";

describe("storage-mock tier demo", () => {
  const storage = mockStorage();
  afterAll(() => storage.restore());

  test("useStorage reads back what it writes, through the mock kv store", async () => {
    const { useStorage } = await import("../hooks/useStorage");
    const { result } = renderHook(() => useStorage("demo_key", "initial"));

    await waitFor(() => expect(result.current[2].loading).toBe(false));
    expect(result.current[0]).toBe("initial");

    act(() => result.current[1]("updated"));
    await waitFor(() => expect(storage.kv.get("demo_key")).toBe(JSON.stringify("updated")));
    expect(result.current[0]).toBe("updated");
  });
});
