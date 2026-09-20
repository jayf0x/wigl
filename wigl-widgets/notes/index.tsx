import { useEffect, useRef } from "react";
import { Copy, PanelLeft, Plus, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownEditor, Sidebar, SidebarAction, SidebarItem, Widget } from "@/wigl";
import { useStorage } from "@/wigl/hooks";
import { cn, relativeTime } from "@/wigl/utils";
import { copyNote, newNote, type Note, STORAGE } from "./notes";

// useStorage writes the whole blob through a sqlite3 spawn per set(), so
// keystrokes are batched: the editor's markdown lands in a ref immediately
// and is committed once typing pauses (and before any action that could
// unmount/replace the editor).
const SAVE_MS = 500;

const NotesWidget = () => {
  const [notes, setNotes] = useStorage<Note[]>(STORAGE.notes, []);
  const [activeID, setActiveID] = useStorage<string | null>(STORAGE.active, null);
  const [sidebarOpen, setSidebarOpen] = useStorage<boolean>(STORAGE.sidebar, true);

  // set() takes a value, not an updater — read the latest list through a ref
  // so the debounced commit never writes a stale closure.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const pending = useRef<{ id: string; body: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const commit = (next: Note[]) => {
    notesRef.current = next;
    setNotes(next);
  };

  const flush = () => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    commit(notesRef.current.map((n) => (n.id === p.id ? { ...n, body: p.body, updated: Date.now() } : n)));
  };
  // Unmount (widget closed) must not drop the last half-second of typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush reads only refs
  useEffect(() => flush, []);

  const sorted = [...notes].sort((a, b) => b.updated - a.updated);
  const active = notes.find((n) => n.id === activeID) ?? null;

  const onBody = (body: string) => {
    if (!active || body === active.body) return;
    pending.current = { id: active.id, body };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_MS);
  };

  const select = (id: string) => {
    flush();
    setActiveID(id);
  };

  const copy = (id: string) => {
    flush();
    const src = notesRef.current.find((n) => n.id === id);
    if (src) add(copyNote(src, notesRef.current));
  };

  const add = (n: Note) => {
    flush();
    commit([n, ...notesRef.current]);
    setActiveID(n.id);
  };

  const rename = (id: string, title: string) =>
    commit(notesRef.current.map((n) => (n.id === id ? { ...n, title, updated: Date.now() } : n)));

  const remove = (id: string) => {
    flush();
    const rest = notesRef.current.filter((n) => n.id !== id);
    commit(rest);
    // Land on the neighbour below it in the list, not on nothing.
    if (id === activeID) {
      const i = sorted.findIndex((n) => n.id === id);
      setActiveID((sorted[i + 1] ?? sorted[i - 1])?.id ?? null);
    }
  };

  return (
    <Widget
      w={6}
      h={6}
      minimizedBackground={<StickyNote className="size-4 opacity-60" />}
      headerContent={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-no-drag
            title={sidebarOpen ? "hide notes" : "show notes"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md text-muted-foreground"
          >
            <PanelLeft className={cn("size-3.5 transition-transform duration-300", !sidebarOpen && "-scale-x-100")} />
          </Button>
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/70">{active?.title ?? "notes"}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-no-drag
            title="new note"
            onClick={() => add(newNote())}
            className="rounded-md text-muted-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar open={sidebarOpen} className="[--sb-w:11rem]">
          {sorted.map((n) => (
            <SidebarItem
              key={n.id}
              title={n.title}
              meta={relativeTime(n.updated / 1000)}
              active={n.id === activeID}
              confirmText="delete this note?"
              onSelect={() => select(n.id)}
              onRename={(title) => rename(n.id, title)}
              onDelete={() => remove(n.id)}
              actions={<SidebarAction icon={Copy} title="duplicate" onClick={() => copy(n.id)} />}
            />
          ))}
        </Sidebar>

        {active ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {/* key remounts the editor per note; `value` is only its initial doc. */}
            <MarkdownEditor key={active.id} value={active.body} onChange={onBody} />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-no-drag
              title="new note"
              onClick={() => add(newNote())}
              className="text-muted-foreground/40 hover:text-foreground"
            >
              <Plus className="size-5" />
            </Button>
          </div>
        )}
      </div>
    </Widget>
  );
};

export default NotesWidget;
