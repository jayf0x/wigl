import { type FormEvent, type RefObject, useEffect, useState } from "react";
import { ChevronLeft, LoaderCircle, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NavView, SearchResults } from "../types";
import type { MusicApi } from "../useMusic";
import { DetailView } from "./DetailView";
import { Equalizer } from "./Equalizer";
import { Row, standardActions, Trash2 } from "./Row";

const GROUPS: { key: keyof SearchResults; label: string }[] = [
  { key: "radio", label: "Stations" },
  { key: "tracks", label: "Tracks" },
  { key: "artists", label: "Artists" },
  { key: "albums", label: "Albums" },
  { key: "playlists", label: "Playlists" },
];

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
  const { results, nav } = api;

  // Debounced live search — only while the browse view is showing.
  useEffect(() => {
    if (nav.kind !== "browse") return;
    const t = setTimeout(() => api.search(q), 260);
    return () => clearTimeout(t);
  }, [q, api.search, nav.kind]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    api.search(q);
  };

  const total = results ? GROUPS.reduce((n, g) => n + results[g.key].length, 0) : 0;
  // MA gives an added provider an instance id like "ytmusic_free--iB4KsJ6x";
  // match on the domain prefix (covers "ytmusic_free" and the paid "ytmusic").
  const ytReady = api.providers.some((p) => p.startsWith("ytmusic"));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {nav.kind === "browse" ? (
        <form onSubmit={submit} className="flex items-center gap-2 px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            data-no-drag
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search music & radio…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
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
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </form>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-2">
          <button
            type="button"
            data-no-drag
            aria-label="Back"
            onClick={api.navBack}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{crumb(nav)}</span>
          <button
            type="button"
            data-no-drag
            onClick={api.navHome}
            className="music-tag shrink-0 rounded px-1.5 py-1 text-muted-foreground/70 hover:text-foreground"
          >
            search
          </button>
        </div>
      )}

      <div className="h-px bg-border" />

      {nav.kind !== "browse" ? (
        <DetailView api={api} />
      ) : (
        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <div className="p-1.5">
            {results ? (
              total === 0 ? (
                <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                  Nothing found for “{q.trim()}”.
                </p>
              ) : (
                GROUPS.filter((g) => results[g.key].length > 0).map((g) => (
                  <section key={g.key} className="mb-1.5">
                    <p className="music-tag px-2 pt-2 pb-1 text-muted-foreground/70">{g.label}</p>
                    {results[g.key].map((it) => (
                      <Row key={it.uri} item={it} api={api} />
                    ))}
                  </section>
                ))
              )
            ) : (
              <UpNext api={api} />
            )}
          </div>
        </ScrollArea>
      )}

      {nav.kind === "browse" && !ytReady && (
        <button
          type="button"
          data-no-drag
          onClick={api.openServer}
          title="Opens Music Assistant → Settings → Music sources → add “YouTube Music (Free)” (no account needed)"
          className="flex shrink-0 items-center justify-center gap-1.5 border-border border-t px-3 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span className="music-tag">＋ add youtube music</span>
        </button>
      )}
    </div>
  );
};

const UpNext = ({ api }: { api: MusicApi }) => {
  if (api.upNext.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-muted-foreground">
        <Equalizer bars={7} active={!!api.now?.playing} className="h-6 text-foreground/50" />
        <p className="text-[11px]">
          {api.now
            ? "Queue is empty — up next shows here."
            : "Nothing playing. Search above to start."}
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="flex items-center justify-between px-2 pt-2 pb-1">
        <p className="music-tag text-muted-foreground/70">Up next · {api.upNext.length}</p>
        <button
          type="button"
          data-no-drag
          onClick={api.clearQueue}
          className="text-[10px] text-muted-foreground hover:text-destructive"
        >
          Clear
        </button>
      </div>
      {api.upNext.map((it, i) => {
        const media = it.media_item ?? null;
        const asItem = media ?? {
          item_id: "",
          provider: "",
          name: it.name,
          uri: `queue:${it.queue_item_id}`,
          media_type: "track" as const,
        };
        const remove = {
          label: "Remove from queue",
          icon: <Trash2 className="size-3.5" />,
          run: () => api.removeFromQueue(it.queue_item_id),
          danger: true,
        };
        return (
          <Row
            key={it.queue_item_id}
            item={asItem}
            api={api}
            index={i + 1}
            onPlay={media ? () => api.play(media, "play") : undefined}
            actions={media ? standardActions(api, media, [remove]) : [remove]}
          />
        );
      })}
    </>
  );
};
