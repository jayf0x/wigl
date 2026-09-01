import { useEffect, useState } from "react";
import { Compass, History, ListMusic, Plus } from "lucide-react";
import { useStorage } from "@/wigl/hooks";
import { cn } from "@/wigl/utils";
import type { MediaItem } from "../types";
import type { MusicApi } from "../useMusic";
import { BrowseTab } from "./BrowseTab";
import { QueueList } from "./QueueList";
import { Row } from "./Row";

/** F1 — quick-access strip of pinned playlists above the tabs (the "YouTube
 * sidebar" idea, horizontal so it costs no width a narrow tile can't spare). */
const PinnedStrip = ({ api }: { api: MusicApi }) => {
  const pinned = api.pinnedPlaylists
    .map((id) => api.playlists.find((p) => p.item_id === id))
    .filter((p): p is MediaItem => !!p);
  if (pinned.length === 0) return null;
  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto px-1.5 pt-1.5" data-no-drag>
      {pinned.map((p) => {
        const art = api.imageUrl(p.metadata?.images?.[0] ?? p.image ?? null);
        return (
          <button
            key={p.item_id}
            type="button"
            data-no-drag
            onClick={() => api.navTo({ kind: "playlist", item: p })}
            title={p.name}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-background text-muted-foreground/40">
              {art ? (
                <img src={art} alt="" className="size-full object-cover" draggable={false} />
              ) : (
                <ListMusic className="size-2.5" />
              )}
            </span>
            <span className="max-w-24 truncate">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
};

type HomeTab = "queue" | "playlists" | "recent" | "browse";

const TABS: { id: HomeTab; label: string }[] = [
  { id: "queue", label: "Up next" },
  { id: "playlists", label: "Playlists" },
  { id: "recent", label: "Recent" },
  { id: "browse", label: "Browse" },
];

const RecentTab = ({ api }: { api: MusicApi }) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh once on mount
  useEffect(() => {
    api.refreshRecent();
  }, []);
  if (api.recentlyPlayed.length === 0)
    return (
      <p className="px-2 py-8 text-center text-[11px] text-muted-foreground">
        Nothing played yet — your history shows here.
      </p>
    );
  return (
    <>
      <p className="music-tag px-2 pt-2 pb-1 text-muted-foreground/70">Recently played</p>
      {api.recentlyPlayed.map((it, i) => (
        <Row key={`${it.uri}:${i}`} item={it} api={api} />
      ))}
    </>
  );
};

const PlaylistsTab = ({ api }: { api: MusicApi }) => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const editable = api.playlists.filter((p) => p.is_editable !== false);
  const smart = api.playlists.filter((p) => p.is_editable === false);

  return (
    <>
      <div className="flex items-center justify-between px-2 pt-2 pb-1">
        <p className="music-tag text-muted-foreground/70">Playlists</p>
        {creating ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void api.createPlaylist(name.trim());
              setName("");
              setCreating(false);
            }}
          >
            {/* biome-ignore lint/a11y/noAutofocus: opened by an explicit click */}
            <input
              data-no-drag
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Playlist name"
              className="w-28 rounded border border-border bg-input/40 px-2 py-0.5 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <button type="submit" data-no-drag className="text-[10px] text-muted-foreground hover:text-foreground">
              add
            </button>
          </form>
        ) : (
          <button
            type="button"
            data-no-drag
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" /> New
          </button>
        )}
      </div>

      {api.playlists.length === 0 && (
        <p className="px-2 py-8 text-center text-[11px] text-muted-foreground">
          No playlists yet. Create one, or add a track to a new playlist from its ⋯ menu.
        </p>
      )}

      {editable.map((p) => (
        <Row key={p.uri} item={p} api={api} onPlay={() => api.navTo({ kind: "playlist", item: p })} />
      ))}
      {smart.length > 0 && (
        <>
          <p className="music-tag px-2 pt-3 pb-1 text-muted-foreground/70">Smart</p>
          {smart.map((p) => (
            <Row key={p.uri} item={p} api={api} onPlay={() => api.navTo({ kind: "playlist", item: p })} />
          ))}
        </>
      )}
    </>
  );
};

export const Home = ({ api }: { api: MusicApi }) => {
  const [tab, setTab] = useStorage<HomeTab>("home_tab", "queue");

  const ICON = { playlists: ListMusic, recent: History, browse: Compass } as const;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PinnedStrip api={api} />
      <div className="flex shrink-0 flex-wrap gap-1 px-1.5 pt-1.5">
        {TABS.map((t) => {
          const Icon = ICON[t.id as keyof typeof ICON];
          return (
            <button
              key={t.id}
              type="button"
              data-no-drag
              onClick={() => setTab(t.id)}
              className={cn(
                "music-tag flex-1 basis-16 rounded px-2 py-1.5 transition-colors",
                tab === t.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {Icon && <Icon className="mr-1 inline size-3 -translate-y-px" />}
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === "browse" ? (
        <BrowseTab api={api} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5" data-no-drag>
          {tab === "queue" ? (
            <QueueList api={api} />
          ) : tab === "playlists" ? (
            <PlaylistsTab api={api} />
          ) : (
            <RecentTab api={api} />
          )}
        </div>
      )}
    </div>
  );
};
