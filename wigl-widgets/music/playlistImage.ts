// One place that decides which image represents a playlist, so the detail
// header, the Playlists-list rows, and the pinned strip never disagree
// (feedback E). Priority: the user's custom background (E3, a base64 data URI
// in storage) > Music Assistant's own playlist art > the first track's art
// (caller-supplied, only the detail view has it) > nothing (icon fallback).

import type { MediaItem } from "./types";
import type { MusicApi } from "./useMusic";

export const playlistDisplayImage = (
  api: MusicApi,
  playlist: MediaItem,
  fallbackArt?: string | null,
): string | null =>
  api.playlistImages[playlist.item_id] ??
  api.imageUrl(playlist.metadata?.images?.[0] ?? playlist.image ?? null) ??
  fallbackArt ??
  null;
