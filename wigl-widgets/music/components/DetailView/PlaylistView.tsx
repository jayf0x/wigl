import { useEffect, useState } from "react";
import { GripVertical, ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";
import { hours, useQuery } from "@/wigl/hooks";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { ScrollArea } from "@/components/ui/scroll-area";
import { pickAndProcessImage } from "@/wigl/utils";
import { PLAYLIST_RENDER_CAP } from "../../music.config";
import { playlistDisplayImage } from "../../playlistImage";
import type { MediaItem } from "../../types";
import type { MusicApi } from "../../useMusic";
import { arrayMove } from "../../util";
import { Row, standardActions } from "../Row";
import { useDragReorder } from "../useDragReorder";
import { guard } from "./guard";
import { Header } from "./Header";
import { Loading } from "./parts";
import { PillBtn } from "./PillBtn";
import { PlayPills } from "./PlayPills";

export const PlaylistView = ({ api, item }: { api: MusicApi; item: MediaItem }) => {
  const [confirmDel, setConfirmDel] = useState(false);
  // Optimistic name until the nav item / playlist list picks up the rename.
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const bg = api.playlistImages[item.item_id] ?? null;

  const pickBackground = async () => {
    setPicking(true);
    const uri = await pickAndProcessImage();
    if (uri) api.setPlaylistImage(item.item_id, uri);
    setPicking(false);
  };
  const [data, loading, { refresh }] = useQuery<{ tracks: MediaItem[] }>({
    key: `playlist:${item.item_id}`,
    stale: 60_000,
    fn: async () => {
      const tracks = await guard(
        () =>
          api.request<MediaItem[]>("music/playlists/playlist_tracks", {
            item_id: item.item_id,
            // library playlists resolve under "library"; a radio_playlist://
            // (or other provider) playlist needs its own provider.
            provider_instance_id_or_domain:
              item.provider && item.provider !== "library" ? item.provider : "library",
          }),
        [],
      );
      return { tracks };
    },
  });

  // Optimistic order during / just after a drag-reorder (P6.2); cleared when a
  // fresh server fetch lands.
  const [order, setOrder] = useState<MediaItem[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new fetch
  useEffect(() => setOrder(null), [data?.tracks]);

  if (loading && !data) return <Loading />;
  const tracks = order ?? data?.tracks ?? [];
  // Only real library playlists can be renamed / deleted / have tracks added.
  const editable = item.is_editable !== false && (!item.provider || item.provider === "library");
  const shownName = nameOverride ?? item.name;
  // Custom background wins over MA art and the first-track fallback (feedback E).
  const art = playlistDisplayImage(
    api,
    item,
    api.imageUrl(tracks[0]?.metadata?.images?.[0] ?? null),
  );

  const canReorder = editable && tracks.length > 1 && tracks.length <= PLAYLIST_RENDER_CAP;
  const dnd = useDragReorder(tracks, (from, to) => {
    const next = arrayMove(tracks, from, to);
    setOrder(next);
    void api
      .reorderPlaylist(
        item.item_id,
        next.map((t) => t.uri).filter((u): u is string => !!u),
      )
      .then(() => setTimeout(refresh, 900));
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        item={item}
        art={art}
        title={shownName}
        bgImage={bg}
        titleNode={
          editable ? (
            <InlineEdit
              value={shownName}
              onSave={(v) => {
                setNameOverride(v);
                void api.renamePlaylist(item, v);
              }}
              className="music-serif line-clamp-2 text-[17px] leading-tight text-foreground"
              inputClassName="text-[15px]"
            />
          ) : undefined
        }
        cover={
          editable ? (
            <div className="absolute inset-0 flex items-center justify-center gap-1 bg-background/70 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100">
              {picking ? (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <Button
                    variant="ghost"
                    data-no-drag
                    aria-label={bg ? "Change background image" : "Add background image"}
                    onClick={pickBackground}
                    className="mx-press grid h-auto size-6 place-items-center rounded p-0 text-foreground"
                  >
                    <ImagePlus className="size-3.5" />
                  </Button>
                  {bg && (
                    <Button
                      variant="ghost"
                      data-no-drag
                      aria-label="Remove background image"
                      onClick={() => api.setPlaylistImage(item.item_id, null)}
                      className="mx-press grid h-auto size-6 place-items-center rounded p-0 text-foreground"
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : undefined
        }
        sub={`${tracks.length} track${tracks.length === 1 ? "" : "s"}${item.owner ? ` · ${item.owner}` : ""}`}
        actions={
          <>
            <PlayPills api={api} item={item} />
            {editable && (
              <PillBtn onClick={() => api.togglePinPlaylist(item.item_id)}>
                {api.pinnedPlaylists.includes(item.item_id) ? "Unpin" : "Pin to top"}
              </PillBtn>
            )}
            {editable &&
              (confirmDel ? (
                <PillBtn
                  onClick={() => {
                    api.deletePlaylist(item);
                    api.navBack();
                  }}
                >
                  really delete?
                </PillBtn>
              ) : (
                <PillBtn onClick={() => setConfirmDel(true)}>Delete</PillBtn>
              ))}
          </>
        }
      />
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="p-1.5">
          {dnd.list.length ? (
            <>
              {dnd.list.slice(0, PLAYLIST_RENDER_CAP).map((t, i) => {
                const pos = order ? i + 1 : (t.position ?? i + 1);
                const key = `${t.uri}:${i}`;
                return (
                  <div key={key} data-reorder-row style={canReorder ? dnd.rowStyle(i, key) : undefined}>
                    <Row
                      item={t}
                      api={api}
                      index={i + 1}
                      actions={
                        editable
                          ? standardActions(api, t, [
                              {
                                label: "Remove from playlist",
                                icon: <Trash2 className="size-3.5" />,
                                danger: true,
                                run: async () => {
                                  await api.removePlaylistTrack(item.item_id, pos);
                                  setTimeout(refresh, 600);
                                },
                              },
                            ])
                          : undefined
                      }
                      dragHandle={
                        canReorder ? (
                          <Button
                            variant="ghost"
                            data-no-drag
                            aria-label="Drag to reorder"
                            {...dnd.handleFor(key, i)}
                            className="-ml-1 h-auto shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/40 hover:bg-transparent hover:text-foreground active:cursor-grabbing"
                          >
                            <GripVertical className="size-3.5" />
                          </Button>
                        ) : undefined
                      }
                    />
                  </div>
                );
              })}
              {tracks.length > PLAYLIST_RENDER_CAP && (
                <p className="px-2 py-3 text-center text-[10px] text-muted-foreground/70">
                  showing first {PLAYLIST_RENDER_CAP} of {tracks.length} — Play all still queues
                  everything
                </p>
              )}
            </>
          ) : (
            <p className="px-2 py-8 text-center text-[11px] text-muted-foreground">
              {loading ? "" : "This playlist is empty."}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
