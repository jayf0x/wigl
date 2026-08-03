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
export const avatarColor = (title: string) => {
  const s = title.slice(0, 2).toLowerCase();
  return AVATAR_COLORS[(s.charCodeAt(0) * 31 + (s.charCodeAt(1) || 0)) % AVATAR_COLORS.length];
};

export interface Draft {
  title: string;
  date: string;
  time: string;
  description: string;
}

export const emptyDraft = (date: string): Draft => ({ title: "", date, time: "", description: "" });

export const draftFrom = (ev: CalendarEvent): Draft => ({
  title: ev.title,
  date: ev.date,
  time: ev.time ?? "",
  description: ev.description ?? "",
});

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "january", "jan", "1".."12" → month index 0–11, or null if unparseable. */
export const parseMonth = (input: string): number | null => {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? n - 1 : null;
  }
  const i = MONTHS.findIndex((m) => m.startsWith(s));
  return i === -1 ? null : i;
};

export const sameDraft = (a: Draft, b: Draft) =>
  a.title === b.title && a.date === b.date && a.time === b.time && a.description === b.description;
