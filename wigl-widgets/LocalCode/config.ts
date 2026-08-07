// Tunables + the useStorage key namespace for this widget, in one place so
// a rename doesn't require hunting through every hook for a string literal.
export const STORAGE_KEYS = {
  pinned: "localcode_pinned", // Record<sessionID, epochMs> — bump-to-top, separate from date sort
  titles: "localcode_titles", // Record<sessionID, string> — user-edited display name overlay
  lastModel: "localcode_last_model", // ModelSelection | null — sticky across sessions
  lastAgent: "localcode_last_agent", // string | null
  lastVariant: "localcode_last_variant", // string | null
  housekeeperModel: "localcode_housekeeper_model", // ModelSelection — see housekeeper.ts
  sidebarOpen: "localcode_sidebar_open", // boolean — sessions rail collapsed state
} as const;

// Fallback if the housekeeper call fails/times out, and the ceiling applied
// to whatever it returns — same "no value ⇒ truncated prompt" default
// `opencode run --title` uses server-side. Not an LLM call by itself.
export const AUTO_TITLE_LENGTH = 40;

// Only providers in this list are offered anywhere in the UI (model picker,
// housekeeper default) — explicit owner scoping: "We only work with Ollama
// for now, later we will add claude code." Extend this list, not a
// special-case branch, when that happens.
export const ALLOWED_PROVIDER_IDS = ["ollama"];

// smollm:135m — small/fast/free, run entirely local via Ollama. Used for
// housekeeping (session titles, and whatever else lands in housekeeper.ts)
// so those never cost a real model call. Configurable later via
// STORAGE_KEYS.housekeeperModel; this is only the seed default.
export const DEFAULT_HOUSEKEEPER_MODEL = { providerID: "ollama", modelID: "smollm:135m" };
