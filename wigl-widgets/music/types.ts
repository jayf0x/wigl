// The slice of Music Assistant's API shapes this widget actually reads. Full
// definitions live at http://127.0.0.1:8095/api-docs/commands.json on the
// running server (see todo-musicplayer.md) — this is deliberately partial.

export type MediaType = "radio" | "artist" | "album" | "track" | "playlist" | "podcast" | "audiobook";

export interface MediaImage {
  path: string;
  provider: string;
  remotely_accessible: boolean;
  /** MA image-proxy id — fetch as `http://<host>:<port>/imageproxy/<proxy_id>`.
   * Present on remote images so art loads without a cross-origin request from
   * the widget. */
  proxy_id?: string;
}

export interface MediaArtistRef {
  name: string;
  /** present on tracks/albums from search + detail fetches — enough to navigate */
  item_id?: string;
  provider?: string;
  uri?: string;
}

export interface MediaItem {
  item_id: string;
  provider: string;
  name: string;
  uri: string;
  media_type: MediaType;
  version?: string;
  /** artists[] on tracks/albums, populated by MA */
  artists?: MediaArtistRef[];
  album?: (MediaArtistRef & { name: string }) | null;
  duration?: number;
  year?: number;
  favorite?: boolean;
  track_number?: number;
  metadata?: {
    images?: MediaImage[] | null;
    genres?: string[] | null;
    description?: string | null;
    links?: { name: string; url: string }[] | null;
  };
}

export type RepeatMode = "off" | "one" | "all";

/** Where the browser pane is pointed. Views replace the pane; now-playing stays. */
export type NavView =
  | { kind: "browse" }
  | { kind: "artist"; item: MediaItem }
  | { kind: "album"; item: MediaItem }
  | { kind: "playlist"; item: MediaItem }
  | { kind: "history" };

export interface SearchResults {
  artists: MediaItem[];
  albums: MediaItem[];
  tracks: MediaItem[];
  playlists: MediaItem[];
  radio: MediaItem[];
  podcasts: MediaItem[];
  audiobooks: MediaItem[];
}

export interface QueueItem {
  queue_item_id: string;
  name: string;
  duration: number;
  media_item?: MediaItem | null;
  image?: MediaImage | null;
  streamdetails?: StreamDetails | null;
}

export interface StreamDetails {
  provider?: string;
  audio_format?: {
    content_type?: string;
    codec_type?: string;
    sample_rate?: number;
    bit_depth?: number;
    channels?: number;
    bit_rate?: number;
  };
  loudness?: number | null;
}

export interface PlayerQueue {
  queue_id: string;
  active: boolean;
  /** "playing" | "paused" | "idle" */
  state: string;
  current_item?: QueueItem | null;
  next_item?: QueueItem | null;
  elapsed_time: number;
  current_index?: number | null;
  items: number;
  flow_mode?: boolean;
  shuffle_enabled: boolean;
  repeat_mode: RepeatMode | string;
  radio_source?: unknown[];
}

/** Merged now-playing view the UI renders. */
export interface NowPlaying {
  title: string;
  subtitle: string;
  artworkUrl: string | null;
  elapsed: number;
  duration: number;
  playing: boolean;
  isRadio: boolean;
}

export type ConnState = "offline" | "connecting" | "connecting-audio" | "ready";
