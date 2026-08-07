// Tunables + the useStorage key namespace for this widget, in one place so
// a rename doesn't require hunting through every hook for a string literal.
export const STORAGE_KEYS = {
  pinned: "localcode_pinned", // Record<sessionID, epochMs> — bump-to-top, separate from date sort
  titles: "localcode_titles", // Record<sessionID, string> — user-edited display name overlay
  lastModel: "localcode_last_model", // ModelSelection | null — sticky across sessions
  lastAgent: "localcode_last_agent", // string | null
  lastVariant: "localcode_last_variant", // string | null
} as const;

// First ~40 chars of the first prompt, cleaned up — the same "no value ⇒
// truncated prompt" default `opencode run --title` already uses server-side
// when we don't pass one ourselves. See AGENTS.md for why this isn't an
// LLM call.
export const AUTO_TITLE_LENGTH = 40;
