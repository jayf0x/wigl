// useQuery — a small cache for expensive async calls (mainly Tauri shell
// commands), not a TanStack Query clone. In-memory by default (a module
// Map, reset on restart); `useSql: true` persists it in the same kv table
// `useStorage` uses, keyed `query_<key>`, with `updatedAt` baked into the
// stored blob so no separate invalidation table is needed.
import { useCallback, useEffect, useRef, useState } from "react";
import { sql, q } from "./storage";

export const hours = (n: number) => n * 60 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  updatedAt: number; // epoch ms
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

async function readSqlCache<T>(key: string): Promise<CacheEntry<T> | null> {
  const raw = (await sql(`SELECT value FROM kv WHERE key=${q(`query_${key}`)}`)).trim();
  if (!raw) return null;
  return JSON.parse(raw) as CacheEntry<T>;
}

async function writeSqlCache<T>(key: string, entry: CacheEntry<T>) {
  const json = JSON.stringify(entry);
  await sql(
    `INSERT INTO kv (key, value) VALUES (${q(`query_${key}`)}, ${q(json)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  );
}

export interface UseQueryOptions<T> {
  key: string;
  fn: () => Promise<T>;
  stale: number; // ms a cached result stays valid for
  useSql?: boolean; // persist across restarts; default in-memory only
}

/**
 * Cached async data, deduped by `key` across every caller:
 *
 *   const [data, loading, { refresh }] = useQuery({ key: "archived", fn: loadArchived, stale: hours(24) });
 *
 * Concurrent calls for the same key share one in-flight request. `refresh()`
 * forces a refetch and updates the cache for everyone reading that key.
 */
export function useQuery<T>({ key, fn, stale, useSql = false }: UseQueryOptions<T>) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const [data, setData] = useState<T | undefined>(() => (memoryCache.get(key) as CacheEntry<T> | undefined)?.data);
  const [loading, setLoading] = useState(!memoryCache.has(key));

  const load = useCallback(
    async (force = false) => {
      const cached = memoryCache.get(key) as CacheEntry<T> | undefined;
      if (!force && cached && Date.now() - cached.updatedAt < stale) {
        setData(cached.data);
        setLoading(false);
        return;
      }

      let promise = force ? undefined : (inflight.get(key) as Promise<T> | undefined);
      promise ??= (async () => {
        const result = await fnRef.current();
        const entry = { data: result, updatedAt: Date.now() };
        memoryCache.set(key, entry);
        if (useSql)
          writeSqlCache(key, entry).catch((e) => console.error(`[wigl] useQuery("${key}") sql write failed`, e));
        return result;
      })();
      inflight.set(key, promise);
      promise.finally(() => inflight.delete(key));

      setLoading(true);
      setData(await promise);
      setLoading(false);
    },
    [key, stale, useSql],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (useSql && !memoryCache.has(key)) {
        try {
          const cached = await readSqlCache<T>(key);
          if (cached) memoryCache.set(key, cached);
        } catch (e) {
          console.error(`[wigl] useQuery("${key}") sql read failed`, e);
        }
      }
      if (!cancelled) load();
    })();
    return () => {
      cancelled = true;
    };
  }, [key, load, useSql]);

  return [data, loading, { refresh: () => load(true) }] as const;
}
