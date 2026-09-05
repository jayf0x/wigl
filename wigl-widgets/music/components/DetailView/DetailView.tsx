import type { MusicApi } from "../../useMusic";
import { AlbumView } from "./AlbumView";
import { ArtistView } from "./ArtistView";
import { PlaylistView } from "./PlaylistView";

export const DetailView = ({ api }: { api: MusicApi }) => {
  const { nav } = api;
  if (nav.kind === "artist") return <ArtistView api={api} item={nav.item} />;
  if (nav.kind === "album") return <AlbumView api={api} item={nav.item} />;
  if (nav.kind === "playlist") return <PlaylistView api={api} item={nav.item} />;
  return null;
};
