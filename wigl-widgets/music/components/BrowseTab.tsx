import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Folder, LoaderCircle } from "lucide-react";
import type { MediaItem } from "../types";
import type { MusicApi } from "../useMusic";
import { providerLabel } from "../util";
import { Row } from "./Row";

interface Crumb {
  path: string | undefined;
  label: string;
}

/** `music/browse` folder navigator. Its own local path stack (a tab, not a
 * global nav-stack view). `music/recommendations` is empty on a fresh library
 * — this is the real "discover" surface. */
export const BrowseTab = ({ api }: { api: MusicApi }) => {
  const [stack, setStack] = useState<Crumb[]>([{ path: undefined, label: "All sources" }]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);
  const here = stack[stack.length - 1];

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    api
      .request<MediaItem[]>("music/browse", here.path ? { path: here.path } : {})
      .then((r) => {
        if (reqId.current !== id) return;
        setItems(Array.isArray(r) ? r.filter((i) => i.name !== "..") : []);
      })
      .catch(() => reqId.current === id && setItems([]))
      .finally(() => reqId.current === id && setLoading(false));
  }, [api.request, here.path]);

  const isFolder = (i: MediaItem) => i.media_type === "folder" || (!!getPath(i) && !i.uri?.includes("://track/"));
  const getPath = (i: MediaItem): string | undefined =>
    // browse folders carry `path`; some carry only `uri`
    (i as unknown as { path?: string }).path ?? (i.media_type === "folder" ? i.uri : undefined);

  const open = (i: MediaItem) => {
    const p = getPath(i);
    if (!p) return;
    const label = stack.length === 1 ? (providerLabel(p) ?? i.name) : i.name;
    setStack((s) => [...s, { path: p, label }]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-1 pt-1 pb-1 text-[10px] text-muted-foreground">
        {stack.length > 1 && (
          <button
            type="button"
            data-no-drag
            aria-label="Back"
            onClick={() => setStack((s) => s.slice(0, -1))}
            className="rounded p-0.5 hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
          </button>
        )}
        {stack.map((c, i) => (
          <span key={c.path ?? "root"} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-2.5 opacity-50" />}
            <button
              type="button"
              data-no-drag
              onClick={() => setStack((s) => s.slice(0, i + 1))}
              className="max-w-24 truncate hover:text-foreground"
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-no-drag>
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-8">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-8 text-center text-[11px] text-muted-foreground">Nothing here.</p>
        ) : (
          items.map((i) =>
            isFolder(i) ? (
              <button
                key={getPath(i) ?? i.name}
                type="button"
                data-no-drag
                onClick={() => open(i)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">
                  {stack.length === 1 ? (providerLabel(getPath(i)) ?? i.name) : i.name}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
              </button>
            ) : (
              <Row key={i.uri || i.item_id} item={i} api={api} />
            ),
          )
        )}
      </div>
    </div>
  );
};
