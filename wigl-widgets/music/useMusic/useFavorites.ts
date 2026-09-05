// Track/album/artist favoriting — independent of the queue/optimism
// machinery, only ever reads `clientRef` (populated by useConnection).
import { useCallback, useState } from "react";
import type { MutableRefObject } from "react";
import type { MaClient } from "../maClient";
import type { MediaItem } from "../types";

export const useFavorites = ({ clientRef }: { clientRef: MutableRefObject<MaClient | null> }) => {
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());

  const toggleFavorite = useCallback(
    (item: MediaItem) => {
      const client = clientRef.current;
      if (!client) return;
      const on = favorites.has(item.uri);
      setFavorites((s) => {
        const n = new Set(s);
        if (on) n.delete(item.uri);
        else n.add(item.uri);
        return n;
      });
      if (on) {
        client
          .command<{ media_type?: string; item_id?: string }>("music/item_by_uri", { uri: item.uri })
          .then((lib) => {
            if (lib?.item_id && lib.media_type)
              return client.command("music/favorites/remove_item", {
                media_type: lib.media_type,
                library_item_id: lib.item_id,
              });
          })
          .catch((e) => console.warn("[music] unfavourite", e));
      } else {
        client
          .command("music/favorites/add_item", { item: item.uri })
          .catch((e) => console.warn("[music] favourite", e));
      }
    },
    [clientRef, favorites],
  );

  return { favorites, toggleFavorite };
};
