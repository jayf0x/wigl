import { useState } from "react";
import { Ellipsis, Heart, Info, ListPlus, Pause, Play, Repeat, Repeat1, Replace, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { useStorage } from "@/wigl/hooks";
import { Button } from "@/components/ui/button";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../../useMusic";
import { RowActionPanel, standardActions } from "../Row";
import { Artwork } from "./Artwork";
import { IconBtn } from "./IconBtn";
import { Scrubber } from "./Scrubber";
import { SpeedControl } from "./SpeedControl";
import { TrackInfo } from "./TrackInfo";
import { VolumeControl } from "./VolumeControl";

export const NowPlaying = ({ api }: { api: MusicApi }) => {
  const { now, repeatMode, shuffle } = api;
  const media = api.currentItem?.media_item ?? null;
  const artist = media?.artists?.[0];
  const album = media?.album ?? null;
  const [infoOpen, setInfoOpen] = useStorage<boolean>("info_open", false);
  const [moreOpen, setMoreOpen] = useState(false);
  const fav = media ? api.favorites.has(media.uri) : false;
  // The current track gets the same action set as a row (C2) — minus the two
  // that make no sense for what's already playing, and favourite (its own btn).
  const moreActions = media
    ? standardActions(api, media).filter(
        (a) => !["Play next", "Add to queue", "Favourite", "Remove favourite"].includes(a.label),
      )
    : [];

  return (
    <div className="flex flex-col gap-3 border-border border-b p-3">
      <div className="flex gap-3">
        <Button
          variant="ghost"
          data-no-drag
          aria-label={album ? `Go to album ${album.name}` : "Artwork"}
          disabled={!album?.uri && !album?.item_id}
          onClick={() =>
            album &&
            api.navTo({
              kind: "album",
              item: {
                item_id: album.item_id ?? "",
                provider: album.provider ?? media?.provider ?? "",
                name: album.name,
                uri: album.uri ?? "",
                media_type: "album",
              },
            })
          }
          className="h-auto w-[clamp(3.5rem,22cqw,7rem)] shrink-0 p-0 enabled:hover:bg-transparent enabled:hover:opacity-90 disabled:cursor-default disabled:opacity-100"
        >
          <Artwork url={now?.artworkUrl ?? null} radio={!!now?.isRadio} />
        </Button>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="music-serif line-clamp-2 text-[clamp(15px,4cqw,22px)] leading-[1.15] text-foreground">
            {now?.title ?? "Nothing playing"}
          </p>
          <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
            {now?.isRadio ? (
              "Live radio"
            ) : artist && (artist.uri || artist.item_id) ? (
              <Button
                variant="link"
                data-no-drag
                onClick={() =>
                  api.navTo({
                    kind: "artist",
                    item: {
                      item_id: artist.item_id ?? "",
                      provider: artist.provider ?? media?.provider ?? "",
                      name: artist.name,
                      uri: artist.uri ?? "",
                      media_type: "artist",
                    },
                  })
                }
                className="h-auto truncate p-0 text-inherit hover:text-foreground"
              >
                {now?.subtitle}
              </Button>
            ) : (
              now?.subtitle || (now ? "" : "Search to start")
            )}
          </p>
        </div>
      </div>

      <Scrubber api={api} />

      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-1">
          <IconBtn
            label="Previous track"
            tap
            tip
            pending={api.pending.has("previous")}
            disabled={api.pending.has("previous")}
            onClick={api.previous}
          >
            <SkipBack className="size-4" fill="currentColor" />
          </IconBtn>
          <IconBtn
            label={now?.playing ? "Pause" : "Play"}
            primary
            tap
            pending={api.pending.has("playPause")}
            disabled={api.pending.has("playPause")}
            onClick={() => {
              api.unlock();
              api.playPause();
            }}
          >
            {now?.playing ? (
              <Pause className="size-[18px]" fill="currentColor" />
            ) : (
              <Play className="size-[18px] translate-x-px" fill="currentColor" />
            )}
          </IconBtn>
          <IconBtn
            label="Next track"
            tap
            tip
            pending={api.pending.has("next")}
            disabled={api.pending.has("next")}
            onClick={api.next}
          >
            <SkipForward className="size-4" fill="currentColor" />
          </IconBtn>
        </div>

        <div className="flex items-center gap-1">
          <IconBtn
            label={
              api.queueMode === "replace"
                ? "Clicking a track replaces the queue — switch to add"
                : "Clicking a track adds to the queue — switch to replace"
            }
            active={api.queueMode === "append"}
            onClick={() => api.setQueueMode(api.queueMode === "replace" ? "append" : "replace")}
          >
            {api.queueMode === "replace" ? (
              <Replace className="size-3.5" />
            ) : (
              <ListPlus className="size-3.5" />
            )}
          </IconBtn>
          <IconBtn
            label={`Shuffle ${shuffle ? "on" : "off"}`}
            active={shuffle}
            onClick={api.toggleShuffle}
          >
            <Shuffle className="size-3.5" />
          </IconBtn>
          <IconBtn
            label={`Repeat ${repeatMode}`}
            active={repeatMode !== "off"}
            onClick={api.cycleRepeat}
          >
            {repeatMode === "one" ? <Repeat1 className="size-3.5" /> : <Repeat className="size-3.5" />}
          </IconBtn>
          <IconBtn
            label={infoOpen ? "Hide track details" : "Track details"}
            active={infoOpen}
            onClick={() => setInfoOpen(!infoOpen)}
          >
            <Info className="size-3.5" />
          </IconBtn>
          {media && (
            <>
              <IconBtn
                label={fav ? "Remove favourite" : "Favourite"}
                active={fav}
                onClick={() => api.toggleFavorite(media)}
              >
                <Heart className={cn("size-3.5", fav && "fill-current")} />
              </IconBtn>
              <IconBtn label="More actions" active={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                <Ellipsis className="size-3.5" />
              </IconBtn>
            </>
          )}
          {now && !now.isRadio && <SpeedControl api={api} />}
          <VolumeControl api={api} />
        </div>
      </div>

      {moreOpen && media && (
        <div className="border-border border-t pt-1">
          <RowActionPanel
            actions={moreActions}
            onClose={() => setMoreOpen(false)}
            className="px-0 pb-0"
          />
        </div>
      )}

      {infoOpen && (
        <div className="border-border border-t pt-1.5">
          <TrackInfo api={api} />
        </div>
      )}
    </div>
  );
};
