// Calendar CLI — reads/writes the same SQLite kv blob the calendar widget
// uses via useStorage (src/wigl/storage.ts). The widget polls the DB, so
// changes made here appear in the open widget within a few seconds.
//
//   bun run calendar:add "2027-12-12" "some event" [HH:MM] [description]
//   bun run calendar:list
//   bun run calendar:rm <id-prefix>
//
// Dates also accepted as DD/MM/YYYY or MM/DD/YYYY-ambiguous "12/12/2027".
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_IDENTIFIER } from "../src/wigl/storage";
import { EVENTS_STORAGE_KEY, type CalendarEvent } from "../src/widgets/calendar/calendar.utils";

// No Tauri runtime here, so no appDataDir() call — reconstruct the same path
// Tauri resolves at runtime, by hand, per OS.
const appDataDir =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", APP_IDENTIFIER)
    : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), APP_IDENTIFIER);
const DB_PATH = join(appDataDir, "wigl.db");
mkdirSync(appDataDir, { recursive: true });
const KEY = EVENTS_STORAGE_KEY;

const db = new Database(DB_PATH, { create: true });
db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

const read = (): CalendarEvent[] => {
  const row = db.query("SELECT value FROM kv WHERE key = ?").get(KEY) as { value: string } | null;
  return row ? JSON.parse(row.value) : [];
};
const write = (events: CalendarEvent[]) =>
  db.run(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [KEY, JSON.stringify(events)],
  );

function parseDate(input: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const m = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // ponytail: DD/MM/YYYY assumed; swap if first part > 12
  if (m) {
    let [, a, b, y] = m;
    if (Number(b) > 12 && Number(a) <= 12) [a, b] = [b, a];
    return `${y}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  console.error(`Cannot parse date "${input}" — use YYYY-MM-DD or DD/MM/YYYY`);
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "add": {
    const [dateArg, title, time, description] = args;
    if (!dateArg || !title) {
      console.error('Usage: bun run calendar:add "2027-12-12" "some event" [HH:MM] [description]');
      process.exit(1);
    }
    const ev: CalendarEvent = { id: crypto.randomUUID(), title, date: parseDate(dateArg), time, description };
    write([...read(), ev]);
    console.log(`Added ${ev.date}${ev.time ? " " + ev.time : ""}  ${ev.title}  (${ev.id.slice(0, 8)})`);
    break;
  }
  case "list": {
    const events = [...read()].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
    if (!events.length) console.log("No events.");
    for (const e of events) console.log(`${e.id.slice(0, 8)}  ${e.date}  ${(e.time ?? "").padEnd(5)}  ${e.title}`);
    break;
  }
  case "rm": {
    const [prefix] = args;
    const events = read();
    const matches = prefix ? events.filter((e) => e.id.startsWith(prefix)) : [];
    if (matches.length !== 1) {
      console.error(matches.length ? `Ambiguous id prefix "${prefix}"` : `No event matching "${prefix ?? ""}" — see calendar:list`);
      process.exit(1);
    }
    write(events.filter((e) => e.id !== matches[0].id));
    console.log(`Removed ${matches[0].date}  ${matches[0].title}`);
    break;
  }
  default:
    console.error("Usage: calendar:add | calendar:list | calendar:rm");
    process.exit(1);
}
