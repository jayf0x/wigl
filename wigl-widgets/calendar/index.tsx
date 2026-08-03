import { type KeyboardEvent, useMemo, useState } from "react";
import { Widget, WidgetHeader } from "@/wigl";
import { useStorage } from "@/wigl/hooks";
import { cn } from "@/wigl/utils";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  avatarColor,
  type CalendarEvent,
  type Draft,
  draftFrom,
  EVENTS_STORAGE_KEY,
  emptyDraft,
  parseMonth,
  sameDraft,
} from "./calendar.utils";
import { Sidebar } from "./Sidebar";

const CalendarWidget = () => {
  const [events, setEvents] = useStorage<CalendarEvent[]>(EVENTS_STORAGE_KEY, []);
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  // selectedId set: sidebar edits that event. null: sidebar is a new-event form.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(format(new Date(), "yyyy-MM-dd")));

  const selected = events.find((e) => e.id === selectedId) ?? null;
  const dirty = !sameDraft(draft, selected ? draftFrom(selected) : emptyDraft(draft.date));
  const canSave = dirty && draft.title.trim() !== "" && draft.date !== "";

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
    return map;
  }, [events]);

  const days = useMemo(() => {
    const start = startOfWeek(view === "month" ? startOfMonth(anchor) : anchor);
    return eachDayOfInterval({ start, end: addDays(start, view === "month" ? 41 : 6) });
  }, [view, anchor]);

  const go = (delta: number) => setAnchor(view === "month" ? addMonths(anchor, delta) : addWeeks(anchor, delta));

  const startNew = (date: string) => {
    setSelectedId(null);
    setDraft(emptyDraft(date));
  };

  const selectEvent = (ev: CalendarEvent) => {
    setSelectedId(ev.id);
    setDraft(draftFrom(ev));
  };

  const save = () => {
    if (!canSave) return;
    const data = {
      title: draft.title.trim(),
      date: draft.date,
      time: draft.time || undefined,
      description: draft.description.trim() || undefined,
    };
    if (selected) {
      setEvents(events.map((e) => (e.id === selected.id ? { ...e, ...data } : e)));
    } else {
      const ev = { ...data, id: crypto.randomUUID() };
      setEvents([...events, ev]);
      setSelectedId(ev.id);
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    setEvents(events.filter((e) => e.id !== selected.id));
    startNew(selected.date);
  };

  return (
    <Widget w={6} h={5} col={8} row={0}>
      <WidgetHeader>
        <span className="px-1 text-[10px] tracking-widest opacity-40">CALENDAR</span>
        <div className="ml-auto flex items-center gap-0.5">
          {(["month", "week"] as const).map((v) => (
            <Button
              key={v}
              variant="ghost"
              size="xs"
              onClick={() => setView(v)}
              className={cn("h-5 px-1.5 text-[10px] capitalize", view === v ? "opacity-90" : "opacity-40")}
            >
              {v}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="xs"
            className="h-5 px-1.5 text-[10px] opacity-40 hover:opacity-90"
            onClick={() => setAnchor(new Date())}
          >
            now
          </Button>
        </div>
      </WidgetHeader>

      <div className="flex min-h-0 flex-1">
        {/* Calendar side */}
        <div className="flex min-w-0 flex-1 flex-col px-2 pb-2">
          <div className="flex items-center justify-between py-1">
            <Button variant="ghost" size="xs" className="h-5 w-5 p-0 opacity-50" onClick={() => go(-1)}>
              <ChevronLeft size={12} />
            </Button>
            {view === "month" ? (
              <MonthYearLabel anchor={anchor} setAnchor={setAnchor} />
            ) : (
              <span className="text-[11px] opacity-70">{`Week of ${format(days[0], "MMM d")}`}</span>
            )}
            <Button variant="ghost" size="xs" className="h-5 w-5 p-0 opacity-50" onClick={() => go(1)}>
              <ChevronRight size={12} />
            </Button>
          </div>

          <div className="grid grid-cols-7 border-b border-border text-center text-[9px] opacity-30">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="pb-0.5">
                {d}
              </div>
            ))}
          </div>

          <div className={cn("grid min-h-0 flex-1 grid-cols-7", view === "month" ? "grid-rows-6" : "grid-rows-1")}>
            {days.map((d) => {
              const key = format(d, "yyyy-MM-dd");
              const dayEvents = eventsByDate.get(key) ?? [];
              const faded = view === "month" && !isSameMonth(d, anchor);
              return (
                // Click a day → new empty event on that date. Clicking an
                // event inside it stops propagation and opens its details.
                <div
                  key={key}
                  onClick={() => startNew(key)}
                  className={cn(
                    "flex cursor-pointer flex-col overflow-hidden border-b border-r border-border/50 px-1 py-0.5",
                    faded && "opacity-30",
                    key === draft.date && "bg-accent/30",
                  )}
                >
                  {/* Fixed-height number row so a day with events never shifts the date */}
                  <div className="flex h-4 shrink-0 items-center">
                    <span
                      className={cn(
                        "text-[9px] leading-none",
                        isToday(d) &&
                          "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground",
                      )}
                    >
                      {format(d, "d")}
                    </span>
                  </div>
                  <div className="flex flex-wrap content-start gap-0.5 overflow-hidden">
                    {dayEvents.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectEvent(ev);
                        }}
                        title={ev.title}
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[4px] text-[8px] font-semibold uppercase leading-none",
                          avatarColor(ev.title),
                          ev.id === selectedId && "ring-1 ring-ring",
                        )}
                      >
                        {ev.title.slice(0, 2)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Sidebar
          draft={draft}
          setDraft={setDraft}
          canSave={canSave}
          canDelete={!!selected}
          onSave={save}
          onDelete={deleteSelected}
          onNew={() => startNew(draft.date || format(anchor, "yyyy-MM-dd"))}
        />
      </div>
    </Widget>
  );
};

export default CalendarWidget;

// Month/year label: double-click either part to type a target ("january",
// "jan", "1" for month; a number for year); blur or Enter navigates.
const MonthYearLabel = ({ anchor, setAnchor }: { anchor: Date; setAnchor: (d: Date) => void }) => {
  const [editing, setEditing] = useState<"month" | "year" | null>(null);
  const [text, setText] = useState("");

  const commit = () => {
    if (editing === "month") {
      const m = parseMonth(text);
      if (m !== null) setAnchor(new Date(anchor.getFullYear(), m, 1));
    } else if (editing === "year") {
      const y = Number(text.trim());
      if (Number.isInteger(y) && y >= 1000 && y <= 9999) setAnchor(new Date(y, anchor.getMonth(), 1));
    }
    setEditing(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(null);
  };

  const edit = (which: "month" | "year") => {
    setText(which === "month" ? format(anchor, "MMMM") : format(anchor, "yyyy"));
    setEditing(which);
  };

  const inputCls =
    "rounded border border-border bg-accent/15 px-1 text-center text-[11px] outline-none focus:border-ring";

  return (
    <span className="flex items-center gap-1 text-[11px] opacity-70">
      {editing === "month" ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className={cn(inputCls, "w-16")}
        />
      ) : (
        <span onDoubleClick={() => edit("month")} title="Double-click to edit" className="cursor-text">
          {format(anchor, "MMMM")}
        </span>
      )}
      {editing === "year" ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className={cn(inputCls, "w-10")}
        />
      ) : (
        <span onDoubleClick={() => edit("year")} title="Double-click to edit" className="cursor-text">
          {format(anchor, "yyyy")}
        </span>
      )}
    </span>
  );
};
