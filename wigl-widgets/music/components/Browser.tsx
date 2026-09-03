import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { ChevronLeft, Clock, LoaderCircle, Search, X } from "lucide-react";
import { useStorage } from "@/wigl/hooks";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/wigl/utils";
import type { NavView, SearchResults } from "../types";
import type { MusicApi } from "../useMusic";
import { DetailView } from "./DetailView";
import { Home } from "./Home";
import { Row } from "./Row";
import { SearchFilters } from "./SearchFilters";

const HISTORY_CAP = 20;

const GROUPS: { key: keyof SearchResults; label: string }[] = [
  { key: "radio", label: "Stations" },
  { key: "tracks", label: "Tracks" },
  { key: "artists", label: "Artists" },
  { key: "albums", label: "Albums" },
  { key: "playlists", label: "Playlists" },
];

/** Thin placeholder strip shown at the top of the results while any provider
 * search is still in flight — previous results stay rendered underneath. */
const SearchSkeleton = () => (
  <div className="mb-2 flex items-center gap-2 px-2 py-1.5 text-[10px] text-muted-foreground/70">
    <LoaderCircle className="size-3 animate-spin" />
    <span className="music-tag">searching…</span>
    <span className="h-px flex-1 animate-pulse bg-border" />
  </div>
);

const crumb = (nav: NavView): string => {
  if (nav.kind === "artist") return nav.item.name || "Artist";
  if (nav.kind === "album") return nav.item.name || "Album";
  if (nav.kind === "playlist") return nav.item.name || "Playlist";
  if (nav.kind === "history") return "Recently played";
  return "Search";
};

export const Browser = ({
  api,
  inputRef,
}: {
  api: MusicApi;
  inputRef: RefObject<HTMLInputElement | null>;
}) => {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useStorage<string[]>("search_history", []);
  const [types, setTypes] = useStorage<string[]>("search_types", []);
  const [providers, setProviders] = useStorage<string[]>("search_providers", []);
  const historyRef = useRef(history);
  historyRef.current = history;
  const { results, nav } = api;
  const opts = { mediaTypes: types, providers };

  const remember = (term: string) => {
    const t = term.trim();
    if (t.length < 2) return;
    const h = historyRef.current;
    setHistory([t, ...h.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, HISTORY_CAP));
  };

  // Debounced live search — only while the browse view is showing. Re-runs when
  // the filter selection changes too. Live search waits for 3+ characters
  // (P8.1 — 1–2 chars are almost all noise and a cold provider round-trip); an
  // empty field still fires, to clear results. An explicit submit or a history
  // chip runs regardless of length.
  useEffect(() => {
    if (nav.kind !== "browse") return;
    const term = q.trim();
    if (term.length > 0 && term.length < 3) return;
    const t = setTimeout(() => api.search(q, { mediaTypes: types, providers }), 220);
    return () => clearTimeout(t);
  }, [q, api.search, nav.kind, types, providers]);

  // Remember a query once typing has settled (longer debounce, so prefixes
  // like "daf" don't pile up — only the query the user stopped on is saved).
  useEffect(() => {
    if (nav.kind !== "browse" || q.trim().length < 3) return;
    const t = setTimeout(() => remember(q), 1400);
    return () => clearTimeout(t);
    // biome-ignore lint/correctness/useExhaustiveDependencies: remember is stable enough; q + nav drive it
  }, [q, nav.kind]);
  const runSearch = (term: string) => {
    setQ(term);
    api.search(term, opts);
    remember(term);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(q);
  };

  const showHistory = nav.kind === "browse" && focused && q.trim() === "" && history.length > 0;

  const total = results ? GROUPS.reduce((n, g) => n + results[g.key].length, 0) : 0;
  // MA gives an added provider an instance id like "ytmusic_free--iB4KsJ6x";
  // match on the domain prefix (covers "ytmusic_free" and the paid "ytmusic").
  const ytReady = api.providers.some((p) => p.startsWith("ytmusic"));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {nav.kind === "browse" ? (
        <div>
          <form onSubmit={submit} className="flex items-center gap-2 px-3 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              data-no-drag
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 120)}
              placeholder="Search music & radio…"
              className={cn(
                "min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60",
                api.searching && "mx-pending-long",
              )}
            />
            {api.searching ? (
              <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : q ? (
              <button
                type="button"
                data-no-drag
                aria-label="Clear search"
                onClick={() => {
                  setQ("");
                  api.clearResults();
                  inputRef.current?.focus();
                }}
                className="mx-press shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </form>
          {showHistory && (
            <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
              {history.map((term) => (
                <button
                  key={term}
                  type="button"
                  data-no-drag
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runSearch(term)}
                  className="mx-press flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Clock className="size-2.5" />
                  {term}
                </button>
              ))}
              <button
                type="button"
                data-no-drag
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setHistory([])}
                className="px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:text-destructive"
              >
                clear
              </button>
            </div>
          )}
          {(q.trim() !== "" || results) && (
            <SearchFilters
              api={api}
              types={types}
              setTypes={setTypes}
              providers={providers}
              setProviders={setProviders}
            />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-2">
          <button
            type="button"
            data-no-drag
            aria-label="Back"
            onClick={api.navBack}
            className="mx-press shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{crumb(nav)}</span>
          <button
            type="button"
            data-no-drag
            onClick={api.navHome}
            className="music-tag mx-press shrink-0 rounded px-1.5 py-1 text-muted-foreground/70 hover:text-foreground"
          >
            search
          </button>
        </div>
      )}

      <div className="h-px bg-border" />

      <div
        key={
          nav.kind !== "browse"
            ? `nav:${crumb(nav)}`
            : results || api.searching
              ? "search"
              : "home"
        }
        className="mx-enter flex min-h-0 flex-1 flex-col"
      >
      {nav.kind !== "browse" ? (
        <DetailView api={api} />
      ) : results || api.searching ? (
        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <div className={cn("p-1.5", api.searching && "mx-pending-long")}>
            {api.searching && <SearchSkeleton />}
            {results && total === 0 && !api.searching ? (
              <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                Nothing found for “{q.trim()}”.
              </p>
            ) : (
              results &&
              GROUPS.filter((g) => results[g.key].length > 0).map((g) => (
                <section key={g.key} className="mb-1.5">
                  <p className="music-tag px-2 pt-2 pb-1 text-muted-foreground/70">{g.label}</p>
                  {results[g.key].map((it) => (
                    <Row key={it.uri} item={it} api={api} />
                  ))}
                </section>
              ))
            )}
          </div>
        </ScrollArea>
      ) : (
        <Home api={api} />
      )}
      </div>

      {nav.kind === "browse" && !ytReady && (
        <button
          type="button"
          data-no-drag
          onClick={api.openServer}
          title="Opens Music Assistant → Settings → Music sources → add “YouTube Music (Free)” (no account needed)"
          className="mx-press flex shrink-0 items-center justify-center gap-1.5 border-border border-t px-3 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span className="music-tag">＋ add youtube music</span>
        </button>
      )}
    </div>
  );
};
