// useStorage — SQLite-backed persistent state, shared across widget windows
// and external writers (e.g. `bun run calendar:add`). Storage is a single kv
// table of JSON blobs in wigl.db under the OS's app-data dir (macOS:
// ~/Library/Application Support/<id>, Linux: ~/.local/share/<id> — Tauri's
// appDataDir() resolves this per platform), accessed by shelling out to the
// system's `sqlite3` CLI (per docs/architecture.md: real CLI over Rust
// commands). sqlite3 isn't bundled, so it's an optional dependency: widgets
// that don't use storage work with none installed; ones that do log a
// read/write error until it is (see docs/debugging.md). External changes are
// picked up by polling.
import { useCallback, useEffect, useRef, useState } from "react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";

// Must match tauri.conf.json's `identifier` — Tauri derives appDataDir()
// from it, and scripts/calendar.ts (no Tauri runtime, so no appDataDir()
// call available) reconstructs the same path by hand from this constant.
export const APP_IDENTIFIER = "com.wigl.desktop";
const POLL_MS = 3000;

// Keys are baked into SQL strings, so restrict them instead of escaping them.
const KEY_RE = /^[a-zA-Z0-9_-]+$/;

let dbPathPromise: Promise<string> | null = null;
async function dbPath(): Promise<string> {
  dbPathPromise ??= (async () => {
    const path = await join(await appDataDir(), "wigl.db");
    // sqlite3 won't create the parent directory; the table is created here
    // too so every later call is a plain read/write.
    await Command.create("sh", [
      "-c",
      `mkdir -p "$(dirname "${path}")" && sqlite3 "${path}" "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"`,
    ]).execute();
    return path;
  })();
  return dbPathPromise;
}

// Exported for query.ts's SQL-backed cache — same kv table, same "shell out
// to sqlite3" rule, no reason for a second DB helper.
export async function sql(query: string): Promise<string> {
  const out = await Command.create("sqlite3", [await dbPath(), query]).execute();
  if (out.code !== 0)
    throw new Error(`sqlite3 failed: ${out.stderr} (is sqlite3 installed? e.g. "apt install sqlite3")`);
  return out.stdout;
}

export const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Like useState, but persisted in the shared wigl SQLite database.
 *
 *   const [events, setEvents, { loading }] = useStorage<Event[]>("calendar_events", []);
 *
 * Values round-trip through JSON. Writes are optimistic (state updates
 * immediately, DB write follows). Changes made outside this window — another
 * widget, or the CLI — show up within POLL_MS.
 */
export function useStorage<T>(key: string, initialValue: T) {
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
        const raw = (await sql(`SELECT value FROM kv WHERE key=${q(key)}`)).trim();
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
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key]);

  const set = useCallback(
    (next: T) => {
      const json = JSON.stringify(next);
      writeSeq.current++;
      lastJson.current = json;
      setValue(next);
      writeChain.current = writeChain.current.then(() =>
        sql(
          `INSERT INTO kv (key, value) VALUES (${q(key)}, ${q(json)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        ).catch((e) => console.error(`[wigl] useStorage("${key}") write failed`, e)),
      );
    },
    [key],
  );

  return [value, set, { loading }] as const;
}
