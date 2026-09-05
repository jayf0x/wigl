import { Button } from "@/components/ui/button";
import type { MediaArtistRef } from "../../types";
import type { MusicApi } from "../../useMusic";

/** A clickable credit — an artist name navigates to the artist view when it
 * resolves to a real library artist, otherwise (and for plain composer /
 * performer strings) it runs a search for the name. */
export const Credit = ({ api, name, artist }: { api: MusicApi; name: string; artist?: MediaArtistRef }) => (
  <Button
    variant="ghost"
    data-no-drag
    onClick={() => {
      if (artist?.uri?.startsWith("library://artist/") && artist.item_id) {
        api.navTo({
          kind: "artist",
          item: {
            item_id: artist.item_id,
            provider: artist.provider ?? "library",
            name: artist.name,
            uri: artist.uri,
            media_type: "artist",
          },
        });
      } else {
        api.navHome();
        api.search(name);
      }
    }}
    className="h-auto rounded border border-border px-1.5 py-0.5 font-normal text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
  >
    {name}
  </Button>
);
