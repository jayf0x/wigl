// Session list + wigl-local overlay (pin, rename) merged into one view
// model. The overlay lives in useStorage, keyed by session id, layered on
// top of — never replacing — opencode's own session records, so uninstalling
// this widget loses nothing opencode itself considers durable.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStorage } from "@/wigl/hooks";
import * as client from "./client";
import { STORAGE_KEYS } from "./config";
import { formatAutoTitle } from "./sessionTitle";
import type { OpencodeSession } from "./types";

export interface SessionView extends OpencodeSession {
  displayTitle: string;
  pinned: boolean;
  pinnedAt: number | null;
}

// ponytail: opencode's own auto-generated `session.title` used to be the
// display fallback here, but its quality wasn't reliable enough to show
// as-is (see backlog.md) — a plain creation timestamp is honest about
// "nobody's named this yet" instead of surfacing whatever the model came up
// with. Manual rename (below) still overrides this immediately. Superseded
// by `Empty #N` for any session that has a number assigned (below) — kept
// only as the fallback for a session created before `sessionNumbers`
// existed, so an old session doesn't retroactively relabel itself.
const legacyDefaultTitle = (created: number) =>
  new Date(created).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// `directory` scopes both the initial fetch and every live SSE event to
// this widget's own working directory — see client.ts's listSessions doc
// comment: opencode's session store is global across every directory
// anyone has ever pointed `opencode serve` at, not per-widget-instance.
export const useSessions = (baseUrl: string | null, directory: string | null) => {
  const [sessions, setSessions] = useState<OpencodeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useStorage<Record<string, number>>(STORAGE_KEYS.pinned, {});
  const [titles, setTitles] = useStorage<Record<string, string>>(STORAGE_KEYS.titles, {});
  const [sessionCounter, setSessionCounter] = useStorage<number>(STORAGE_KEYS.sessionCounter, 0);
  const [sessionNumbers, setSessionNumbers] = useStorage<Record<string, number>>(STORAGE_KEYS.sessionNumbers, {});

  // `useStorage`'s setter always writes a literal value, not a `(prev) =>
  // next` updater (see its own source) — so two `assignNumber` calls in the
  // same tick (e.g. two sessions created back to back, before either
  // storage write has re-rendered this hook) would otherwise both close
  // over the same stale `sessionCounter`/`sessionNumbers` and hand out the
  // same "next" number twice. Refs make each call see the other's update
  // immediately, independent of the render/persist cycle; kept in sync with
  // the persisted value on every render so a value hydrated later from the
  // DB (useStorage's own async initial read) still wins once it lands.
  const sessionCounterRef = useRef(sessionCounter);
  sessionCounterRef.current = sessionCounter;
  const sessionNumbersRef = useRef(sessionNumbers);
  sessionNumbersRef.current = sessionNumbers;
  // Same reasoning, for `titles`: without this, two renames landing in the
  // same tick (e.g. an auto-rename for one session racing a manual rename
  // on another) could each compute `{...titles, [id]: title}` off the same
  // stale snapshot, and the second write would silently drop the first.
  const titlesRef = useRef(titles);
  titlesRef.current = titles;

  // One shared counter drives both "Empty #N" (a session with no messages
  // yet) and "#N ..." (its auto-generated title once one arrives) — the
  // same number, assigned once per session, not two separate sequences.
  // `createSession` assigns it eagerly for a session created going forward;
  // this is the fallback for one that predates `sessionNumbers` (or, in
  // principle, raced the write) and only reaches its first message later.
  const assignNumber = useCallback(
    (sessionID: string): number => {
      const existing = sessionNumbersRef.current[sessionID];
      if (existing != null) return existing;
      const next = sessionCounterRef.current + 1;
      sessionCounterRef.current = next;
      setSessionCounter(next);
      const nextNumbers = { ...sessionNumbersRef.current, [sessionID]: next };
      sessionNumbersRef.current = nextNumbers;
      setSessionNumbers(nextNumbers);
      return next;
    },
    [setSessionCounter, setSessionNumbers],
  );

  const refresh = useCallback(() => {
    if (!baseUrl || !directory) return;
    client
      .listSessions(baseUrl, directory)
      .then(setSessions)
      .catch((e) => console.error("[LocalCode] failed to list sessions", e))
      .finally(() => setLoading(false));
  }, [baseUrl, directory]);

  useEffect(() => {
    if (!baseUrl || !directory) return;
    refresh();
    // session.* events keep this list live without a poll loop — see
    // AGENTS.md's "two SSE connections" note for why this and
    // useActiveSession subscribe separately instead of sharing one stream.
    return client.subscribeEvents(baseUrl, (event) => {
      if (event.type === "session.created" || event.type === "session.updated") {
        const info = event.properties.info;
        if (info.directory !== directory) return;
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === info.id);
          if (idx === -1) return [info, ...prev];
          const next = [...prev];
          next[idx] = info;
          return next;
        });
      } else if (event.type === "session.deleted") {
        setSessions((prev) => prev.filter((s) => s.id !== event.properties.info.id));
      }
    });
  }, [baseUrl, directory, refresh]);

  const views = useMemo<SessionView[]>(
    () =>
      sessions
        .map((s) => {
          const number = sessionNumbers[s.id];
          const fallback = number != null ? `Empty #${number}` : legacyDefaultTitle(s.time.created);
          return {
            ...s,
            displayTitle: titles[s.id] || fallback,
            pinned: s.id in pinned,
            pinnedAt: pinned[s.id] ?? null,
          };
        })
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (a.pinned && b.pinned) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
          return b.time.updated - a.time.updated;
        }),
    [sessions, titles, pinned, sessionNumbers],
  );

  const createSession = useCallback(
    async (directory: string) => {
      if (!baseUrl) throw new Error("opencode server not connected");
      const session = await client.createSession(baseUrl, { directory });
      setSessions((prev) => [session, ...prev]);
      assignNumber(session.id); // so it shows "Empty #N" immediately, before any message
      return session;
    },
    [baseUrl, assignNumber],
  );

  const renameSession = useCallback(
    (sessionID: string, title: string) => {
      const next = { ...titlesRef.current, [sessionID]: title };
      titlesRef.current = next;
      setTitles(next);
      if (baseUrl) client.renameSession(baseUrl, sessionID, title).catch((e) => console.error(e));
    },
    [baseUrl, setTitles],
  );

  // Fires once per session, right after its first user message is sent
  // (see SessionPanel.tsx's onSend) — deterministic, non-LLM (sessionTitle.ts),
  // never overwrites a title the user (or a prior call to this) already
  // set: the `sessionID in titles` guard both skips a manual rename made
  // before the first message and makes this naturally idempotent, so
  // callers don't need their own "already auto-titled" bookkeeping. Never
  // throws: sessionTitle.ts's own `formatAutoTitle` already degrades to the
  // bare `#N` for input YAKE can't say anything about, and this wraps it in
  // a try/catch on top of that so a session is never left permanently
  // untitled over an unexpected extraction failure. Reuses whatever number
  // `createSession` already assigned this session (falls back to assigning
  // one now for a session that predates that, or somehow doesn't have one
  // yet) — same counter drives the pre-message "Empty #N" placeholder and
  // this real title.
  const autoRenameSession = useCallback(
    (sessionID: string, firstMessageText: string) => {
      if (sessionID in titlesRef.current) return;
      const number = assignNumber(sessionID);
      let title: string;
      try {
        title = formatAutoTitle(number, firstMessageText);
      } catch (e) {
        console.error("[LocalCode] auto-title generation failed, falling back to the bare counter", e);
        title = `#${number}`;
      }
      const next = { ...titlesRef.current, [sessionID]: title };
      titlesRef.current = next;
      setTitles(next);
      if (baseUrl) client.renameSession(baseUrl, sessionID, title).catch((e) => console.error(e));
    },
    [baseUrl, setTitles, assignNumber],
  );

  const togglePin = useCallback(
    (sessionID: string) => {
      const next = { ...pinned };
      if (sessionID in next) delete next[sessionID];
      else next[sessionID] = Date.now();
      setPinned(next);
    },
    [pinned, setPinned],
  );

  const deleteSession = useCallback(
    async (sessionID: string) => {
      if (!baseUrl) return;
      await client.deleteSession(baseUrl, sessionID);
      setSessions((prev) => prev.filter((s) => s.id !== sessionID));
    },
    [baseUrl],
  );

  return { sessions: views, loading, refresh, createSession, renameSession, autoRenameSession, togglePin, deleteSession };
};
