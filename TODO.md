## Theming: part 0 (research, done)

Findings:

- Popover (`src/components/ui/popover.tsx`) already themes correctly, no
  change needed: it uses semantic Tailwind classes (`bg-popover`,
  `text-popover-foreground`, `ring-foreground/10`) which map to the
  `--popover` / `--popover-foreground` / `--foreground` CSS vars in
  `src/App.css`'s `@theme` block. Any mechanism that rewrites those vars
  (Part 1) makes the popover follow automatically — same as every other
  shadcn component here. Generators (TweakCN, shadcn wizard, Shadesigner)
  and libs (Color.js, Culori, OKLCH utilities) are all just *producers* of
  a flat `{--var: value}` map; they don't change what Part 1 needs to
  build, they're an optional future input to it (paste a generated palette
  in as a preset). Not needed to unblock Part 1/2.
- Terax's mechanism (`/home/oi/code/terax-ai/src/modules/theme/`) confirms
  the trimmed-down plan already written in Part 1 is right:
  - `types.ts`: `Theme = {id, name, variants: {light?, dark?}}`, each
    variant a flat `Partial<ThemeColors>` (background, foreground, card,
    popover, primary, secondary, muted, accent, destructive, border,
    input, ring, sidebar*, radius — all optional, missing keys fall
    through to CSS default).
  - `applyTheme.ts`: one function, `root.style.setProperty` in a loop over
    a `COLOR_VAR` key-to-`--css-var` map, `removeProperty` for anything
    not set. No terminal-palette part applies to wigl (Terax-specific).
  - wigl has no light/dark toggle (nothing ever applies `.dark`), so each
    preset is a single flat variant, not light+dark — simpler than Terax.
    None of Terax's preset library, theme-as-file editing, JSON schema
    validation, or cross-window sync apply either — confirmed out of scope
    per `docs/future-ideas.md` and `.idea/terax/terax-guide.md`.
  - Worth porting as starter presets (`themes/*.ts`, pick a few, not all
    15): `terax-default`, `nord`, `dracula`, `catppuccin`, `gruvbox` cover
    the popular/distinct look spread; skip the rest unless asked.

Conclusion: Part 1 and Part 2 as already scoped in this file are correct
and don't need redefining. Proceed to Part 1: add the `ThemeColors` type +
`applyTheme` loop + a handful of ported presets, store active theme id via
`useStorage`, apply on load and on change. No generator integration needed
now — note it in `docs/future-ideas.md` as a possible later input to preset
authoring, not a blocker.

## Theming part 1: Logic (done)

Built in `src/wigl/theme/`:

- `types.ts` — flat `ThemeColors` (one key per `App.css` `@theme` token,
  plus `wiglAccent`) and `ThemePreset = {id, name, colors}`.
- `applyTheme.ts` — `root.style.setProperty` loop over a key-to-`--css-var`
  map; clears every managed var first so switching presets doesn't leave
  stale values. Also mirrors `--wigl-accent` into a plain JS var
  (`getWiglAccent()`) since the drag-field canvas in `Desktop.tsx` can't
  read a CSS custom property per animation frame.
- `presets.ts` — `default` (empty, i.e. `App.css`'s own look) plus `nord`,
  `dracula`, `catppuccin`, `gruvbox`, ported from Terax's dark variants
  (wigl has no light/dark toggle, so only one variant per preset).
- `src/wigl/hooks/useTheme.ts` — active preset id via `useStorage`
  (`wigl_theme` key), applies on mount and on change. Every monitor window
  runs its own `useTheme()` (called once, in `Desktop.tsx`), so picking a
  theme on one screen updates every other screen's window too, through
  `useStorage`'s existing DB-poll — no new sync mechanism.
- `.wigl-menu` in `App.css` (the right-click menu) was hardcoded
  black/white — switched to `var(--popover)` / `var(--popover-foreground)`
  / `var(--accent)` so it follows the theme like every other surface. No
  remaining hardcoded-color UI surface in the app.

## Theming part 2: Customization (done)

`src/wigl/ThemeSettingsPopover.tsx` + a `"settings"` global action
registered in `Desktop.tsx`: right-click → Settings opens a shadcn Popover
(anchored at the click point via a virtual anchor — wigl has no persistent
chrome to hang a real trigger element off) listing the presets. Clicking
one calls `useTheme`'s setter, which applies immediately and persists via
`useStorage` — no separate save step.

## Most urgent backlog items

Most urgent items in `backlog.md`, by title only — see that file for details,
scope, and fix shape. Nothing here duplicates content; this is a shortlist,
not a second source of truth.

- Cross-monitor drag col/row offset on screens of different sizes (Bugs)
- First-launch layout settles in report order, not globally (Bugs)
- Windowed-mode interactive flows unverified end-to-end (Bugs)
