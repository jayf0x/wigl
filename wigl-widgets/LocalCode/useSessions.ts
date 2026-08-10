// Session list + wigl-local overlay (pin, rename) merged into one view
// model. The overlay lives in useStorage, keyed by session id, layered on
// top of — never replacing — opencode's own session records, so uninstalling
// this widget loses nothing opencode itself considers durable.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStorage } from "@/wigl/hooks";
import * as client from "./client";
import { AUTO_TITLE_LENGTH, HOUSEKEEPER_SESSION_TITLE, STORAGE_KEYS } from "./config";
import type { OpencodeSession } from "./types";

export interface SessionView extends OpencodeSession {
  displayTitle: string;
  pinned: boolean;
  pinnedAt: number | null;
}

const autoTitle = (prompt: string) => {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > AUTO_TITLE_LENGTH ? `${clean.slice(0, AUTO_TITLE_LENGTH).trimEnd()}…` : clean;
};

// `directory` scopes both the initial fetch and every live SSE event to
// this widget's own working directory — see client.ts's listSessions doc
// comment: opencode's session store is global across every directory
// anyone has ever pointed `opencode serve` at, not per-widget-instance.
export const useSessions = (baseUrl: string | null, directory: string | null) => {
  const [sessions, setSessions] = useState<OpencodeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useStorage<Record<string, number>>(STORAGE_KEYS.pinned, {});
  const [titles, setTitles] = useStorage<Record<string, string>>(STORAGE_KEYS.titles, {});

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
        // Drop the housekeeper's throwaway sessions — they surface over SSE
        // for a beat before deletion and otherwise read as duplicates (#4).
        .filter((s) => s.title !== HOUSEKEEPER_SESSION_TITLE)
        .map((s) => ({
          ...s,
          displayTitle: titles[s.id] || s.title || "untitled",
          pinned: s.id in pinned,
          pinnedAt: pinned[s.id] ?? null,
        }))
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (a.pinned && b.pinned) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
          return b.time.updated - a.time.updated;
        }),
    [sessions, titles, pinned],
  );

  const createSession = useCallback(
    async (directory: string, firstPrompt?: string) => {
      if (!baseUrl) throw new Error("opencode server not connected");
      const title = firstPrompt ? autoTitle(firstPrompt) : undefined;
      const session = await client.createSession(baseUrl, { directory, title });
      setSessions((prev) => [session, ...prev]);
      return session;
    },
    [baseUrl],
  );

  const renameSession = useCallback(
    (sessionID: string, title: string) => {
      setTitles({ ...titles, [sessionID]: title });
      if (baseUrl) client.renameSession(baseUrl, sessionID, title).catch((e) => console.error(e));
    },
    [baseUrl, titles, setTitles],
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

  return { sessions: views, loading, refresh, createSession, renameSession, togglePin, deleteSession };
};
