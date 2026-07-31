// useStorage — SQLite-backed persistent state, shared across widget windows
// and external writers (e.g. `bun run calendar:add`). See ./client.ts for
// the DB/table it reads and writes. External changes from another process
// (a CLI script) are picked up by polling; changes from another wigl window
// (another monitor's Desktop, or another widget) arrive near-instantly over
// a broadcast event instead of waiting up to POLL_MS.
import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { sql, sqlLiteral } from "../storage/client";

const POLL_MS = 3000;

// Keys are baked into SQL strings, so restrict them instead of escaping them.
const KEY_RE = /^[a-zA-Z0-9_-]+$/;

// One id per JS realm (each screen-<i> window is its own webview/realm) so a
// window can recognize and ignore its own broadcasts.
const SESSION_ID = Math.random().toString(36).slice(2);

interface KvMsg {
  key: string;
  json: string;
  from: string;
}

/**
 * Like useState, but persisted in the shared wigl SQLite database.
 *
 *   const [events, setEvents, { loading }] = useStorage<Event[]>("calendar_events", []);
 *
 * Values round-trip through JSON. Writes are optimistic (state updates
 * immediately, DB write follows). Changes made outside this window — another
 * widget, or the CLI — show up within POLL_MS.
 */
export const useStorage = <T>(key: string, initialValue: T) => {
  if (!KEY_RE.test(key)) throw new Error(`useStorage key must match ${KEY_RE}: "${key}"`);
  const [value, setValue] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  // Last JSON we read or wrote — poll results matching it are no-ops.
  const lastJson = useRef<string | null>(null);
  // Bumped on every local write. A poll started before a write resolving
  // after it is stale — even if its JSON differs from lastJson — so a read
  // captures the seq at start and discards its result if a write beat it home.
  const writeSeq = useRef(0);
  // Chains writes so two rapid set() calls commit in call order instead of
  // racing as independent fire-and-forget sqlite3 spawns.
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const seq = writeSeq.current;
      try {
        const raw = (await sql(`SELECT value FROM kv WHERE key=${sqlLiteral(key)}`)).trim();
        if (cancelled || !raw || raw === lastJson.current || writeSeq.current !== seq) return;
        lastJson.current = raw;
        setValue(JSON.parse(raw));
      } catch (e) {
        console.error(`[wigl] useStorage("${key}") read failed`, e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    read();
    const id = setInterval(read, POLL_MS);
    const unlisten = listen<KvMsg>("wigl-kv", ({ payload: p }) => {
      if (p.from === SESSION_ID || p.key !== key || p.json === lastJson.current) return;
      lastJson.current = p.json;
      setValue(JSON.parse(p.json));
    });
    return () => {
      cancelled = true;
      clearInterval(id);
      unlisten.then((u) => u());
    };
  }, [key]);

  const set = useCallback(
    (next: T) => {
      const json = JSON.stringify(next);
      writeSeq.current++;
      lastJson.current = json;
      setValue(next);
      emit("wigl-kv", { key, json, from: SESSION_ID } satisfies KvMsg).catch(console.error);
      writeChain.current = writeChain.current.then(() =>
        sql(
          `INSERT INTO kv (key, value) VALUES (${sqlLiteral(key)}, ${sqlLiteral(json)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        ).catch((e) => console.error(`[wigl] useStorage("${key}") write failed`, e)),
      );
    },
    [key],
  );

  return [value, set, { loading }] as const;
};
