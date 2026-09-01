import { cn } from "@/wigl/utils";
import type { MusicApi } from "../useMusic";
import { providerLabel } from "../util";

/** MA `music/search` media_types, in the order search results are grouped. */
export const TYPE_OPTIONS: { id: string; label: string }[] = [
  { id: "track", label: "Tracks" },
  { id: "artist", label: "Artists" },
  { id: "album", label: "Albums" },
  { id: "playlist", label: "Playlists" },
  { id: "radio", label: "Stations" },
];

const Pill = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    data-no-drag
    onClick={onClick}
    className={cn(
      "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
      active
        ? "border-foreground/30 bg-accent text-foreground"
        : "border-border text-muted-foreground hover:text-foreground",
    )}
  >
    {children}
  </button>
);

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** Type + provider filter pills. Empty selection = "all". */
export const SearchFilters = ({
  api,
  types,
  setTypes,
  providers,
  setProviders,
}: {
  api: MusicApi;
  types: string[];
  setTypes: (v: string[]) => void;
  providers: string[];
  setProviders: (v: string[]) => void;
}) => {
  const provOptions = api.providers.filter((p) => !p.startsWith("builtin"));

  return (
    <div className="flex flex-col gap-1 px-3 pb-2">
      <div className="flex flex-wrap items-center gap-1">
        <Pill active={types.length === 0} onClick={() => setTypes([])}>
          All
        </Pill>
        {TYPE_OPTIONS.map((t) => (
          <Pill key={t.id} active={types.includes(t.id)} onClick={() => setTypes(toggle(types, t.id))}>
            {t.label}
          </Pill>
        ))}
      </div>
      {provOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <Pill active={providers.length === 0} onClick={() => setProviders([])}>
            All sources
          </Pill>
          {provOptions.map((p) => (
            <Pill
              key={p}
              active={providers.includes(p)}
              onClick={() => setProviders(toggle(providers, p))}
            >
              {providerLabel(p)}
            </Pill>
          ))}
        </div>
      )}
    </div>
  );
};
