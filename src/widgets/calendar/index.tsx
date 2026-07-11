import { useMemo, useState } from "react";
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
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Widget, WidgetHeader, useStorage, type WidgetWindowConfig } from "@/wigl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const windowConfig: WidgetWindowConfig = { width: 470, height: 380, x: 640, y: 40 };

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  time?: string; // "HH:MM"
  description?: string;
}

// Same kv key the CLI writes (scripts/calendar.ts) — keep them in sync.
export const EVENTS_STORAGE_KEY = "calendar_events";

// Deterministic color from the event's first two chars — same label, same color.
const AVATAR_COLORS = [
  "bg-sky-400/25 text-sky-200",
  "bg-emerald-400/25 text-emerald-200",
  "bg-amber-400/25 text-amber-200",
  "bg-rose-400/25 text-rose-200",
  "bg-violet-400/25 text-violet-200",
  "bg-teal-400/25 text-teal-200",
  "bg-orange-400/25 text-orange-200",
  "bg-fuchsia-400/25 text-fuchsia-200",
];
const avatarColor = (title: string) => {
  const s = title.slice(0, 2).toLowerCase();
  return AVATAR_COLORS[(s.charCodeAt(0) * 31 + (s.charCodeAt(1) || 0)) % AVATAR_COLORS.length];
};

interface Draft {
  title: string;
  date: string;
  time: string;
  description: string;
}
const emptyDraft = (date: string): Draft => ({ title: "", date, time: "", description: "" });
const draftFrom = (ev: CalendarEvent): Draft => ({
  title: ev.title,
  date: ev.date,
  time: ev.time ?? "",
  description: ev.description ?? "",
});

export default function CalendarWidget() {
  const [events, setEvents] = useStorage<CalendarEvent[]>(EVENTS_STORAGE_KEY, []);
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  // selectedId: editing that event. null: creating a new one. Sidebar is
  // always the same form; only where "save" writes to differs.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(format(new Date(), "yyyy-MM-dd")));

  const selected = events.find((e) => e.id === selectedId) ?? null;
  const baseline = selected ? draftFrom(selected) : emptyDraft(draft.date);
  const dirty =
    draft.title !== baseline.title ||
    draft.date !== baseline.date ||
    draft.time !== baseline.time ||
    draft.description !== baseline.description;
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
    <Widget>
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
        </div>
      </WidgetHeader>

      <div className="flex min-h-0 flex-1">
        {/* Calendar side */}
        <div className="flex min-w-0 flex-1 flex-col px-2 pb-2">
          <div className="flex items-center justify-between py-1">
            <Button variant="ghost" size="xs" className="h-5 w-5 p-0 opacity-50" onClick={() => go(-1)}>
              <ChevronLeft size={12} />
            </Button>
            <span className="text-[11px] opacity-70">
              {view === "month" ? format(anchor, "MMMM yyyy") : `Week of ${format(days[0], "MMM d")}`}
            </span>
            <Button variant="ghost" size="xs" className="h-5 w-5 p-0 opacity-50" onClick={() => go(1)}>
              <ChevronRight size={12} />
            </Button>
          </div>

          <div className="grid grid-cols-7 border-b border-white/10 text-center text-[9px] opacity-30">
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
                <div
                  key={key}
                  onDoubleClick={() => startNew(key)}
                  className={cn(
                    "flex flex-col overflow-hidden border-b border-r border-white/5 px-1 py-0.5",
                    faded && "opacity-30",
                    key === draft.date && "bg-white/5",
                  )}
                >
                  {/* Fixed-height number row so a day with events never shifts the date */}
                  <div className="flex h-4 shrink-0 items-center">
                    <span
                      className={cn(
                        "text-[9px] leading-none",
                        isToday(d) &&
                          "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/85 text-black",
                      )}
                    >
                      {format(d, "d")}
                    </span>
                  </div>
                  <div className="flex flex-wrap content-start gap-0.5 overflow-hidden">
                    {dayEvents.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={() => selectEvent(ev)}
                        onDoubleClick={(e) => e.stopPropagation()}
                        title={ev.title}
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[4px] text-[8px] font-semibold uppercase leading-none",
                          avatarColor(ev.title),
                          ev.id === selectedId && "ring-1 ring-white/70",
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

        {/* Sidebar — always present: actions on top, details form below */}
        <div className="flex w-[150px] shrink-0 flex-col gap-1.5 border-l border-white/10 px-2.5 py-2 text-[10px]">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="xs"
              className="h-5 w-5 p-0 opacity-60 hover:opacity-100"
              title="New event"
              onClick={() => startNew(draft.date || format(anchor, "yyyy-MM-dd"))}
            >
              <Plus size={12} />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="h-5 w-5 p-0 text-red-400/70 hover:text-red-400 disabled:opacity-20"
              title="Delete event"
              disabled={!selected}
              onClick={deleteSelected}
            >
              <Trash2 size={12} />
            </Button>
            <span className="ml-auto text-[9px] opacity-30">{selected ? "edit" : "new"}</span>
          </div>

          <Field label="title">
            <input
              value={draft.title}
              placeholder="Event title"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="date">
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="time">
            <input
              type="time"
              value={draft.time}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="notes">
            <textarea
              value={draft.description}
              rows={3}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className={cn(inputCls, "resize-none")}
            />
          </Field>

          <Button
            variant="outline"
            size="xs"
            className="mt-auto h-6 w-full text-[10px]"
            disabled={!canSave}
            onClick={save}
          >
            save
          </Button>
        </div>
      </div>
    </Widget>
  );
}

const inputCls =
  "w-full rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[10px] outline-none focus:border-white/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[8px] uppercase tracking-widest opacity-30">{label}</span>
      {children}
    </label>
  );
}
