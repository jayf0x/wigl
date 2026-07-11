import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { Widget, WidgetHeader, useStorage, type WidgetWindowConfig } from "@/wigl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const windowConfig: WidgetWindowConfig = { width: 320, height: 430, x: 640, y: 40 };

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  time?: string; // "HH:MM"
  description?: string;
}

// Same kv key the CLI writes (scripts/calendar.ts) — keep them in sync.
export const EVENTS_STORAGE_KEY = "calendar_events";

export default function CalendarWidget() {
  const [events, setEvents, { loading }] = useStorage<CalendarEvent[]>(EVENTS_STORAGE_KEY, []);
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [adding, setAdding] = useState(false);

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

  const deleteEvent = (id: string) => {
    setEvents(events.filter((e) => e.id !== id));
    setSelected(null);
  };

  const addEvent = (ev: Omit<CalendarEvent, "id">) => {
    setEvents([...events, { ...ev, id: crypto.randomUUID() }]);
    setAdding(false);
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
          <Button
            variant="ghost"
            size="xs"
            className="h-5 px-1.5 text-[10px] opacity-40 hover:opacity-90"
            onClick={() => setAnchor(new Date())}
          >
            today
          </Button>
        </div>
      </WidgetHeader>

      {/* Month/week navigation */}
      <div className="flex items-center justify-between px-2 py-1">
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

      {/* Weekday labels */}
      <div className="grid grid-cols-7 border-b border-white/10 text-center text-[9px] opacity-30">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="pb-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className={cn("grid flex-1 grid-cols-7 overflow-hidden", view === "month" ? "grid-rows-6" : "grid-rows-1")}>
        {days.map((d) => {
          const dayEvents = eventsByDate.get(format(d, "yyyy-MM-dd")) ?? [];
          const faded = view === "month" && !isSameMonth(d, anchor);
          return (
            <div
              key={d.toISOString()}
              className={cn("overflow-hidden border-b border-r border-white/5 p-0.5", faded && "opacity-30")}
            >
              <div
                className={cn(
                  "mb-0.5 text-[9px] leading-none",
                  isToday(d) && "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/85 text-black",
                )}
              >
                {format(d, "d")}
              </div>
              <div className="flex flex-col gap-px">
                {dayEvents.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => setSelected(ev)}
                    title={ev.title}
                    className={cn(
                      "truncate rounded-sm bg-sky-400/15 px-0.5 text-left text-[9px] leading-tight text-sky-300 hover:bg-sky-400/30",
                      view === "week" && "text-[10px] py-0.5",
                    )}
                  >
                    {view === "week" && ev.time ? `${ev.time} ` : ""}
                    {ev.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: add button / add form / event detail */}
      <div className="border-t border-white/10 px-2 py-1.5 text-[11px]">
        {selected ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-start gap-1">
              <span className="font-medium">{selected.title}</span>
              <div className="ml-auto flex gap-0.5">
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-5 w-5 p-0 text-red-400/70 hover:text-red-400"
                  onClick={() => deleteEvent(selected.id)}
                >
                  <Trash2 size={11} />
                </Button>
                <Button variant="ghost" size="xs" className="h-5 w-5 p-0 opacity-50" onClick={() => setSelected(null)}>
                  <X size={11} />
                </Button>
              </div>
            </div>
            <span className="text-[10px] opacity-50">
              {format(parseISO(selected.date), "EEEE, MMM d yyyy")}
              {selected.time ? ` · ${selected.time}` : ""}
            </span>
            {selected.description && <span className="text-[10px] opacity-70">{selected.description}</span>}
          </div>
        ) : adding ? (
          <AddEventForm defaultDate={format(anchor, "yyyy-MM-dd")} onAdd={addEvent} onCancel={() => setAdding(false)} />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-1 opacity-40 hover:opacity-80"
          >
            <Plus size={11} /> add event
            {loading && <span className="ml-auto text-[9px] opacity-60">loading…</span>}
          </button>
        )}
      </div>
    </Widget>
  );
}

function AddEventForm({
  defaultDate,
  onAdd,
  onCancel,
}: {
  defaultDate: string;
  onAdd: (ev: Omit<CalendarEvent, "id">) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");

  const submit = () => {
    if (!title.trim() || !date) return;
    onAdd({ title: title.trim(), date, time: time || undefined });
  };

  const inputCls = "rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[10px] outline-none focus:border-white/30";
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input autoFocus placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      <div className="flex gap-1">
        {/* ponytail: native date/time inputs over a picker component */}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, "flex-1")} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(inputCls, "w-20")} />
        <Button type="submit" variant="ghost" size="xs" className="h-6 px-1.5 text-[10px]" disabled={!title.trim()}>
          add
        </Button>
        <Button type="button" variant="ghost" size="xs" className="h-6 w-6 p-0 opacity-50" onClick={onCancel}>
          <X size={11} />
        </Button>
      </div>
    </form>
  );
}
