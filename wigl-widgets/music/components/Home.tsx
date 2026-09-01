import { useEffect, useState } from "react";
import { History, ListMusic, Plus } from "lucide-react";
import { useStorage } from "@/wigl/hooks";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../useMusic";
import { QueueList } from "./QueueList";
import { Row } from "./Row";

type HomeTab = "queue" | "playlists" | "recent";

const TABS: { id: HomeTab; label: string }[] = [
  { id: "queue", label: "Up next" },
  { id: "playlists", label: "Playlists" },
  { id: "recent", label: "Recent" },
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 px-1.5 pt-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-no-drag
            onClick={() => setTab(t.id)}
            className={cn(
              "music-tag flex-1 rounded px-2 py-1.5 transition-colors",
              tab === t.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {t.id === "playlists" && <ListMusic className="mr-1 inline size-3 -translate-y-px" />}
            {t.id === "recent" && <History className="mr-1 inline size-3 -translate-y-px" />}
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" data-no-drag>
        {tab === "queue" ? (
          <QueueList api={api} />
        ) : tab === "playlists" ? (
          <PlaylistsTab api={api} />
        ) : (
          <RecentTab api={api} />
        )}
      </div>
    </div>
  );
};
