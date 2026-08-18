// Tunables + the useStorage key namespace for this widget, in one place so
// a rename doesn't require hunting through every hook for a string literal.
export const STORAGE_KEYS = {
  pinned: "localcode_pinned", // Record<sessionID, epochMs> — bump-to-top, separate from date sort
  titles: "localcode_titles", // Record<sessionID, string> — user-edited display name overlay
  lastModel: "localcode_last_model", // ModelSelection | null — sticky across sessions
  lastAgent: "localcode_last_agent", // string | null
  lastVariant: "localcode_last_variant", // string | null
  sidebarOpen: "localcode_sidebar_open", // boolean — sessions rail collapsed state
} as const;

// Only providers in this list are offered anywhere in the UI (model picker)
// — explicit owner scoping: "We only work with Ollama for now, later we
// will add claude code." Extend this list, not a special-case branch, when
// that happens.
export const ALLOWED_PROVIDER_IDS = ["ollama"];

// The agent a brand-new session gets when the user hasn't picked one —
// opencode's own default (an unset `agent` on the request) is `"build"`,
// which attaches its *full* tool schema (bash, edit, ...) to every turn.
// For a plain "test?"-style chat message that's a real hazard with a small
// local model: it sees bash/curl as available tools and — confirmed live —
// will attempt to use them on an ambiguous one-word prompt instead of just
// replying. `opencodeConfig.ts`'s `syncChatAgent` declares this id as a
// primary agent with every permission denied (verified live: the model
// then never even sees a tool schema, no attempted calls, no "does not
// support tools" 400s either). The agent chip still lets a session opt
// into `"build"`/`"plan"` when real tool use is wanted.
export const DEFAULT_CHAT_AGENT = "wigl-chat";
