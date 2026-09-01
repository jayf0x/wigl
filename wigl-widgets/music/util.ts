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

/** MA gives a multi-instance provider an id like `ytmusic_free--iB4KsJ6x`;
 * the part before `--` is the domain. Returns a friendly label. */
export const providerLabel = (id?: string | null): string | null => {
  if (!id) return null;
  const base = id.split("--")[0];
  return PROVIDER_NAMES[base] ?? base;
};
