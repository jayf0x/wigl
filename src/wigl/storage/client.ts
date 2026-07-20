// Shared SQLite plumbing for useStorage and useQuery — one kv table of JSON
// blobs in wigl.db under the OS's app-data dir (macOS: ~/Library/Application
// Support/<id>, Linux: ~/.local/share/<id> — Tauri's appDataDir() resolves
// this per platform), accessed by shelling out to the system's `sqlite3` CLI
// (per docs/architecture.md: real CLI over Rust commands). sqlite3 isn't
// bundled, so it's an optional dependency: widgets that don't use storage
// work with none installed; ones that do log a read/write error until it is
// (see docs/debugging.md).
import { appDataDir, join } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";

let dbPathPromise: Promise<string> | null = null;
const dbPath = (): Promise<string> => {
  dbPathPromise ??= (async () => {
    const path = await join(await appDataDir(), "wigl.db");
    // sqlite3 won't create the parent directory; the table is created here
    // too so every later call is a plain read/write.
    await Command.create("sh", [
      "-c",
      `mkdir -p "$(dirname "${path}")" && sqlite3 "${path}" "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"`,
    ]).execute();
    return path;
  })();
  return dbPathPromise;
};

export const sql = async (query: string): Promise<string> => {
  const out = await Command.create("sqlite3", [await dbPath(), query]).execute();
  if (out.code !== 0)
    throw new Error(`sqlite3 failed: ${out.stderr} (is sqlite3 installed? e.g. "apt install sqlite3")`);
  return out.stdout;
};

/** Quotes a value for inline use in a SQL string (doubles embedded single quotes). */
export const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
