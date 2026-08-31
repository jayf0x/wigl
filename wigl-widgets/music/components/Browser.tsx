import { type FormEvent, type RefObject, useEffect, useState } from "react";
import { ListPlus, LoaderCircle, Radio, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MediaItem, SearchResults } from "../types";
import type { MusicApi } from "../useMusic";
import { Equalizer } from "./Equalizer";

const GROUPS: { key: keyof SearchResults; label: string }[] = [
  { key: "radio", label: "Stations" },
  { key: "tracks", label: "Tracks" },
  { key: "artists", label: "Artists" },
  { key: "albums", label: "Albums" },
  { key: "playlists", label: "Playlists" },
];

const subtitleFor = (it: MediaItem): string => {
  if (it.media_type === "radio") return "Radio";
  if (it.media_type === "artist") return "Artist";
  return it.artists?.map((a) => a.name).join(", ") || it.album?.name || it.media_type;
};

const Row = ({ item, api }: { item: MediaItem; api: MusicApi }) => {
  const art = api.imageUrl(item.metadata?.images?.[0] ?? null);
  const canRadio =
    item.media_type === "radio" || item.media_type === "artist" || item.media_type === "track";
  return (
    <div className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent">
      <button
        type="button"
        data-no-drag
        onClick={() => {
          api.unlock();
          api.play(item, "play");
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded border border-border bg-background text-muted-foreground/30">
          {art ? (
            <img src={art} alt="" className="size-full object-cover" draggable={false} />
          ) : (
            <Radio className="size-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-foreground">{item.name.trim()}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{subtitleFor(item)}</span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {canRadio && (
          <button
            type="button"
            data-no-drag
            aria-label="Start radio from this"
            title="Start radio"
            onClick={() => {
              api.unlock();
              api.startRadio(item);
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Radio className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          data-no-drag
          aria-label="Add to queue"
          title="Add to queue"
          onClick={() => api.play(item, "add")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ListPlus className="size-3.5" />
        </button>
      </div>
    </div>
  );
};

export const Browser = ({
  api,
  inputRef,
}: {
  api: MusicApi;
  inputRef: RefObject<HTMLInputElement | null>;
}) => {
  const [q, setQ] = useState("");
  const { results } = api;

  // Debounced live search.
  useEffect(() => {
    const t = setTimeout(() => api.search(q), 260);
    return () => clearTimeout(t);
  }, [q, api.search]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    api.search(q);
  };

  const total = results ? GROUPS.reduce((n, g) => n + results[g.key].length, 0) : 0;
  const ytReady = api.providers.includes("ytmusic");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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

      <div className="h-px bg-border" />

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

      {!ytReady && (
        <button
          type="button"
          data-no-drag
          onClick={api.openServer}
          title="Opens Music Assistant — add the YouTube Music provider and sign in"
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
      {api.upNext.map((it, i) => (
        <div key={it.queue_item_id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <span className="w-4 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">
            {it.name.trim()}
          </span>
        </div>
      ))}
    </>
  );
};
