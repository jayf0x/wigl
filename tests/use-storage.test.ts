// Real coverage for useStorage (replaces the mock-storage tier demo). The
// hook is the shared persistence layer every widget's state rides on, plus
// the layout/settings core. Covered here: key validation, load lifecycle,
// optimistic write + read-back, and cross-window broadcast reception (the
// `wigl-kv` event path that makes another monitor's write show up here
// without waiting for the 3s poll). The sqlite3 shell-out itself lives in
// storage/client.ts and is mocked — see tests/mock-storage.ts.
import { act, renderHook, waitFor } from "@testing-library/react";
import { mockStorage } from "./mock-storage";
import { afterAll, describe, expect, test } from "bun:test";

const storage = mockStorage();
afterAll(() => storage.restore());

const load = () => import("../src/wigl/hooks/useStorage");

describe("useStorage", () => {
  test("rejects a key outside the SQL-safe charset", async () => {
    const { useStorage } = await load();
    expect(() => renderHook(() => useStorage("bad key!", 0))).toThrow(/useStorage key must match/);
  });

  test("accepts the registry's `<widget-id>:` prefixed keys", async () => {
    const { useStorage } = await load();
    expect(() => renderHook(() => useStorage("todo:events", []))).not.toThrow();
  });

  test("starts loading, then settles to the initial value when the row is absent", async () => {
    const { useStorage } = await load();
    const { result } = renderHook(() => useStorage("us_absent", "seed"));
    expect(result.current[2].loading).toBe(true);
    await waitFor(() => expect(result.current[2].loading).toBe(false));
    expect(result.current[0]).toBe("seed");
  });

  test("optimistic write: state updates immediately and the kv row catches up", async () => {
    const { useStorage } = await load();
    const { result } = renderHook(() => useStorage<string>("us_write", "a"));
    await waitFor(() => expect(result.current[2].loading).toBe(false));

    act(() => result.current[1]("b"));
    expect(result.current[0]).toBe("b"); // synchronous, before the DB write
    await waitFor(() => expect(storage.kv.get("us_write")).toBe(JSON.stringify("b")));
  });

  test("hydrates from an existing kv row rather than the initial value", async () => {
    storage.kv.set("us_existing", JSON.stringify({ n: 42 }));
    const { useStorage } = await load();
    const { result } = renderHook(() => useStorage("us_existing", { n: 0 }));
    await waitFor(() => expect(result.current[0]).toEqual({ n: 42 }));
  });

  test("a wigl-kv broadcast for the same key updates a second reader near-instantly", async () => {
    const { useStorage } = await load();
    const writer = renderHook(() => useStorage<number>("us_bcast", 0));
    const reader = renderHook(() => useStorage<number>("us_bcast", 0));
    await waitFor(() => expect(reader.result.current[2].loading).toBe(false));

    act(() => writer.result.current[1](7));
    // No poll wait — the mock's emit() delivers the event synchronously,
    // same shape Tauri uses; the reader picks it up off `wigl-kv`.
    await waitFor(() => expect(reader.result.current[0]).toBe(7));
  });
});
