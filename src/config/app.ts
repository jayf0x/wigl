// App-wide identity, sourced from the single place it's actually defined —
// never hand-duplicate this string. Tauri derives appDataDir() from
// `identifier`, and scripts/calendar.ts (no Tauri runtime, so no
// appDataDir() call available) reconstructs the same path by hand using
// this same constant, so a drift here would silently point the CLI and the
// app at two different databases.
import tauriConf from "../../src-tauri/tauri.conf.json";

export const APP_IDENTIFIER = tauriConf.identifier;
