// Small shared helpers for the music widget's own components.

const PROVIDER_NAMES: Record<string, string> = {
  ytmusic_free: "YouTube Music",
  ytmusic: "YouTube Music",
  radiobrowser: "RadioBrowser",
  builtin: "Music Assistant",
  library: "Library",
  tunein: "TuneIn",
  spotify: "Spotify",
  tidal: "Tidal",
  qobuz: "Qobuz",
  subsonic: "Subsonic",
  jellyfin: "Jellyfin",
  plex: "Plex",
  apple_music: "Apple Music",
};

/** Pure array-move used by the queue drag-reorder (P0.5): pop `from`, insert at
 * `from + posShift` clamped to the array. Matches MA's `move_item` semantics
 * (relative shift on a contiguous slice). Returns a new array; `list` untouched. */
export const arrayMove = <T>(list: T[], from: number, posShift: number): T[] => {
  if (from < 0 || from >= list.length || !posShift) return list;
  const to = Math.max(0, Math.min(list.length - 1, from + posShift));
  if (to === from) return list;
  const copy = [...list];
  const [it] = copy.splice(from, 1);
  copy.splice(to, 0, it);
  return copy;
};

/** MA gives a multi-instance provider an id like `ytmusic_free--iB4KsJ6x`;
 * the part before `--` is the domain. Returns a friendly label. */
export const providerLabel = (id?: string | null): string | null => {
  if (!id) return null;
  const base = id.split("--")[0];
  return PROVIDER_NAMES[base] ?? base;
};
