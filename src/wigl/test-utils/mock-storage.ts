// A fake `../storage/client` + `@tauri-apps/api/event` for testing anything
// that goes through `useStorage`/`useQuery` (see hooks/useStorage.ts,
// hooks/useQuery.ts) without a real sqlite3 binary or Tauri IPC — an
// in-memory Map standing in for the kv table, and a same-process pub/sub
// standing in for wigl's cross-window "wigl-kv" broadcast.
//
// Usage — call this BEFORE importing the hook under test, since
// `mock.module` only affects modules resolved after it runs:
//
//   import { mockStorage } from "@/wigl/test-utils/mock-storage";
//   const storage = mockStorage();
//   const { useStorage } = await import("../useStorage");
//   // ...render a component using useStorage, then:
//   storage.kv.get("some_key"); // inspect what got written
//
// `mock.module` is process-global and Bun does not auto-restore it between
// test files, so call `storage.restore()` in an `afterEach`/`afterAll` if a
// later test in the same run needs the real modules back.
import { mock } from "bun:test";

type Listener<T> = (payload: T) => void;

export const mockStorage = () => {
  const kv = new Map<string, string>();
  const listeners = new Map<string, Set<Listener<unknown>>>();

  mock.module("../storage/client", () => ({
    sql: async (query: string): Promise<string> => {
      // Just enough SQL-shape recognition for what useStorage/useQuery
      // actually send — not a real parser. Extend here if a future test
      // needs a query shape this doesn't cover yet.
      const select = query.match(/^SELECT value FROM kv WHERE key=(.+)$/);
      if (select) return kv.get(unquote(select[1])) ?? "";

      const upsert = query.match(/^INSERT INTO kv \(key, value\) VALUES \((.+), (.+)\) ON CONFLICT/);
      if (upsert) {
        kv.set(unquote(upsert[1]), unquote(upsert[2]));
        return "";
      }

      throw new Error(`mock-storage: unrecognized query shape: ${query}`);
    },
    sqlLiteral: (value: string) => `'${value.replace(/'/g, "''")}'`,
  }));

  // Real Tauri events arrive as `{ event, id, payload }`; every listener
  // here destructures `.payload` (see useStorage.ts/useQuery.ts), so the
  // mock must wrap the same way rather than handing back the bare payload.
  mock.module("@tauri-apps/api/event", () => ({
    emit: async (event: string, payload: unknown) => {
      for (const l of listeners.get(event) ?? []) l({ payload });
    },
    listen: async <T>(event: string, cb: Listener<{ payload: T }>) => {
      const set = (listeners.get(event) ?? new Set()) as Set<Listener<unknown>>;
      set.add(cb as Listener<unknown>);
      listeners.set(event, set);
      return () => set.delete(cb as Listener<unknown>);
    },
  }));

  return {
    kv,
    restore: () => mock.restore(),
  };
};

const unquote = (sqlLiteralValue: string) => sqlLiteralValue.trim().slice(1, -1).replace(/''/g, "'");
