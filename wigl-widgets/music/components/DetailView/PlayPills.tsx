import type { MediaItem } from "../../types";
import type { MusicApi } from "../../useMusic";
import { PillBtn } from "./PillBtn";

/** Primary "play this collection" button — always starts playback now; the
 * queue-mode toggle only decides whether the current tail survives. An explicit
 * "Add to queue" sits alongside in append mode for the silent-append case. */
export const PlayPills = ({ api, item }: { api: MusicApi; item: MediaItem }) => (
  <>
    <PillBtn
      tap
      onClick={() => {
        api.unlock();
        api.play(item);
      }}
    >
      Play
    </PillBtn>
    {api.queueMode !== "replace" && (
      <PillBtn
        tap
        onClick={() => {
          api.unlock();
          api.play(item, "add");
        }}
      >
        Add to queue
      </PillBtn>
    )}
  </>
);
