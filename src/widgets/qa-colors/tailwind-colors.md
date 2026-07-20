# Tailwind color inventory + qa-colors widget

Written while building the `qa-colors` widget (`src/widgets/qa-colors/`) so the
theming work (`src/wigl/theme/`) has a live surface to check "which value
changed, which should, which shouldn't" against. Regenerate the palette JSON
with `bun run tw-colors` if `tailwindcss` ever gets bumped (it dumps
`node_modules/tailwindcss/theme.css`'s `--color-*` vars, one JSON file per
run — see `scripts/tw-colors.ts`).

## The widget

Three tabs:

1. **Theme tokens** — every CSS var `applyTheme` writes (`src/wigl/theme/types.ts`'s
   `THEME_COLOR_KEYS`) plus `--wigl-accent`, as raw swatches read live off
   `var(--x)`. These are the ones that must react to a preset switch or to
   dragging the custom-theme knobs (`ThemeSettingsPopover.tsx`). A dashed
   amber outline flags the "static" group (see below) that currently doesn't.
2. **Components** — real coss ui components (buttons, badges, checkbox,
   switch, slider, input, select, progress, a card surface) wired through
   their normal semantic classes, no color props. If a widget looks wrong
   here, the bug is upstream in the token values, not in these components.
3. **Tailwind palette** — the full raw Tailwind scale for reference when
   picking what hue/lightness a parametric formula should land on. These are
   inert literals; nothing here is theme-reactive and nothing should be.

Open the theme popover (right-click desktop → Settings, or wherever it's
wired) alongside this widget and drag knobs / switch presets — every
"Theme tokens" swatch and every "Components" element should move together.

## The semantic tokens (`THEME_COLOR_KEYS`, 19 total)

These are the only values a preset or `generateParametricColors` needs to
supply (`src/wigl/theme/types.ts`, `applyTheme.ts`):

`background, foreground, card, cardForeground, popover, popoverForeground,
primary, primaryForeground, secondary, secondaryForeground, muted,
mutedForeground, accent, accentForeground, destructive, border, input, ring,
wiglAccent`

All 19 are exercised in the qa-colors widget's "Theme tokens" tab. Notes:

- `destructive` is deliberately **not** derived from the 3 parametric knobs
  (`parametric.ts`'s comment: "danger shouldn't change meaning because the
  user picked a red brand") — fixed `oklch(0.704 0.191 22.216)` in every
  preset today. If the expanded system adds more knobs, this one should
  probably stay pinned or get its own explicit override, not fall out of the
  same weighted-mix formula as `primary`/`accent`.
- `border`/`input` ride on `foreground`'s lightness at fixed alpha (0.1/0.15)
  rather than being independent knobs — cheap and always legible, but two
  themes with very different `foreground` hues currently produce
  indistinguishable gray borders. Worth a knob if "how visible should
  dividers be" ever becomes a tunable.
- `wiglAccent` is the one non-CSS-var-mapped token — read via
  `getWiglAccent()` in JS (Canvas draw loop), not a Tailwind utility class.
  No `bg-wigl-accent` exists; the widget renders it with an inline
  `background: var(--wigl-accent)` style instead. Keep that in mind if the
  expanded system adds more JS-consumed (non-CSS) tokens — they need the
  same `currentAccent`-style mirror in `applyTheme.ts`, not just a `:root` var.

## Static, non-theme-reactive tokens (flag for follow-up)

`bunx shadcn add @coss/badge` (and friends) wrote a **second** set of color
vars straight into `src/App.css`'s `:root`/`.dark` blocks, outside
`src/wigl/theme/` entirely:

`--destructive-foreground, --info, --info-foreground, --success,
--success-foreground, --warning, --warning-foreground`

These are fixed references to raw Tailwind palette shades (`var(--color-red-700)`,
`var(--color-emerald-500)`, ...) and do **not** move with the active theme —
confirmed by the dashed-outline "Status" group in the qa-colors widget, which
stays put while every other swatch changes. Badge variants `error`/`info`/
`success`/`warning` and any future coss ui component that reads `--warning`
etc. will silently ignore theme switches.

Two ways to close this gap, for whoever picks it up:
- Fold these 7 into `THEME_COLOR_KEYS`/`ThemeColors` and have every preset +
  `generateParametricColors` supply them (most consistent, touches every
  preset).
- Leave them static on purpose — they're semantic *severity* colors
  (red=danger, amber=warning, ...), arguably supposed to mean the same thing
  regardless of brand theme, per `AGENTS.md`'s own carve-out for "status-style
  icon colors that carry fixed meaning regardless of theme." If so, no code
  change needed — just move this note to `docs/architecture.md` or wherever
  makes it official instead of an unexplained gap.

Either way, right now it's an inconsistency (not a decision) — `destructive`
lives in `THEME_COLOR_KEYS` and is per-theme; `destructive-foreground` doesn't
and isn't. Pick one.

## Raw Tailwind palette (from `node_modules/tailwindcss/theme.css`)

28 families, 11 shades each (50–950) except `black`/`white` (single value).
Full JSON: `src/widgets/qa-colors/tw-colors.generated.json`.

Standard Tailwind v4 families (22): `red, orange, amber, yellow, lime, green,
emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose,
slate, gray, zinc, neutral, stone`.

Non-standard extras present in this repo's `tailwindcss` package (6):
`mauve, olive, mist, taupe` — muted/desaturated near-gray families,
distinct from the standard `slate`/`gray`/`zinc`/`neutral`/`stone` set — plus
`black`/`white`. Not documented anywhere upstream that I could find; likely
bundled by whatever installed coss ui's registry alongside `tailwindcss`.
Useful as extra low-saturation options for `background`/`card`/`border`-style
tokens if the standard grays feel too neutral/cool; ignorable otherwise — no
widget currently references them.

All values are `oklch(...)` (except `black`/`white`, which are hex) — same
color space `parametric.ts` mixes in, so lifting a shade straight out of this
palette into a knob or a formula constant needs no conversion.