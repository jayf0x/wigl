## Theming

Copy Terax's theme presets and its apply mechanism, trimmed down — not the
full system (no editor-theme pairing, no theme-as-file editing UX, no JSON
schema validation, no cross-window sync machinery — wigl has one window
per monitor and no settings UI to sync against).

Read these in Terax (`/home/oi/code/terax-ai`) first:

- `src/modules/theme/types.ts` — the `Theme`/`ThemeColors` shape
- `src/modules/theme/applyTheme.ts` — the actual mechanism
- `src/modules/theme/themes/*.ts` + `themes/index.ts` — the preset color
  values themselves, pick a handful worth porting
- `src/modules/theme/ThemeProvider.tsx` — skim only, most of it (multi-window
  sync, localStorage flicker shadow) doesn't apply to wigl

Then read in wigl:

- `.idea/terax/terax-guide.md` → "Theming mechanism" section — trimmed
  summary of the above, and what to skip
- `docs/future-ideas.md` → "Theming beyond..." entry — the agreed scope
- `src/App.css` — wigl's current `@theme` CSS var tokens; a theme overrides
  these
- `src/wigl/hooks/useStorage.ts` — persist the active theme choice the same
  way any other widget state persists

Basic concept: a theme is a flat object of CSS variable values. Applying
one is a loop of `root.style.setProperty(--var, value)` on
`document.documentElement` — no context/provider layer needed, no
stylesheet swap. Store the chosen theme id via `useStorage`, apply it once
on load and again whenever it changes.

## Most urgent backlog items

Most urgent items in `backlog.md`, by title only — see that file for details,
scope, and fix shape. Nothing here duplicates content; this is a shortlist,
not a second source of truth.

- Cross-monitor drag col/row offset on screens of different sizes (Bugs)
- First-launch layout settles in report order, not globally (Bugs)
- Windowed-mode interactive flows unverified end-to-end (Bugs)
