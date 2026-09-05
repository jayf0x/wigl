import type { ReactNode } from "react";
import { Disc3, User } from "lucide-react";
import type { MediaItem } from "../../types";

export const Header = ({
  item,
  art,
  sub,
  actions,
  title,
  titleNode,
  bgImage,
  cover,
}: {
  item: MediaItem;
  art: string | null;
  sub: string;
  actions: ReactNode;
  /** overrides `item.name` (used for a live rename before the nav item updates) */
  title?: string;
  /** replaces the title <p> entirely — e.g. an `<InlineEdit>` (P6.3) */
  titleNode?: ReactNode;
  /** E3 — a data-URI background for the playlist header, dimmed for legibility */
  bgImage?: string | null;
  /** P6.4 — hover controls overlaid on the cover thumbnail (edit / remove) */
  cover?: ReactNode;
}) => (
  <div className="relative flex gap-3 overflow-hidden border-border border-b p-3">
    {bgImage && (
      <>
        <div
          className="absolute inset-0 bg-center bg-cover"
          style={{ backgroundImage: `url("${bgImage}")` }}
        />
        <div className="absolute inset-0 bg-background/80" />
      </>
    )}
    <div className="group/cover relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-background text-muted-foreground/30">
      {art ? (
        <img src={art} alt="" loading="lazy" decoding="async" fetchPriority="low" className="size-full object-cover" draggable={false} />
      ) : item.media_type === "artist" ? (
        <User className="size-6" />
      ) : (
        <Disc3 className="size-6" />
      )}
      {cover}
    </div>
    <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-1">
      {titleNode ?? (
        <p className="music-serif line-clamp-2 text-[17px] leading-tight text-foreground">
          {title ?? item.name ?? "—"}
        </p>
      )}
      <p className="line-clamp-1 text-[10px] text-muted-foreground">{sub}</p>
      <div className="mt-1 flex flex-wrap gap-1">{actions}</div>
    </div>
  </div>
);
