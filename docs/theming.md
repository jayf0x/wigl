# Theming

`src/wigl/theme/` is the single source of every color in the app. `App.css`
defines no color values at all — the theme owns `:root`, full stop.

## The flow

```
ThemeColors (types.ts)
    ↑ supplied by
PRESETS (presets.ts)            generateParametricColors (parametric.ts)
    \                                  /
     \                                /
        ThemeEffect.tsx (reads persisted theme id/knobs, applies on change)
                    ↓
        applyTheme (theme/applyTheme.ts)
                    ↓
        CSS custom properties on :root
                    ↓
        Tailwind utility classes (bg-primary, border-border, ...)

        Appearance settings section (settings/sections/appearance.tsx)
        (the UI — reads/writes the same persisted theme id/knobs)
```

`ThemeColors` (`types.ts`) is the contract: a fixed list of ~18 semantic
tokens (background, card, popover, primary, accent, border, ring, ...).
Every producer — every hand-written preset, and the parametric generator —
must supply every key; the `Record` type makes a missing or extra key a
compile error. `applyTheme` just loops that object onto `:root` via
`setProperty`, an unconditional full overwrite, never a partial patch.

Two ways to produce a `ThemeColors`:

- **Presets** (`presets.ts`): a literal object per theme, hand-picked colors.
  Adding one is copy an existing entry, change the values, done.
- **Parametric** (`parametric.ts`): a photo-filter mental model, not a CSS-var
  editor. 3 hue dials (`hueBackground`/`huePrimary`/`hueAccent`, degrees
  0-360) pick which color family each *role* reads as — dragging `huePrimary`
  only ever changes primary/ring/wiglAccent's hue, nothing else, because
  every role's lightness and chroma come from a fixed formula, never a value
  the knob sets directly. 3 global filters (`brightness`/`contrast`/
  `saturation`) then nudge those formulas for every token at once:
  `brightness` is where `background`'s own lightness sits (0 darkest, 1
  lightest — every formula that reads "the gap between foreground and
  background" flips direction with it, see `isDarkBg`), `contrast` scales
  how far foreground and every elevated surface separate from background,
  `saturation` scales chroma for `primary`/`accent` only — background/card/
  secondary stay near-gray regardless, matching how a hand-written theme
  keeps its neutrals neutral. `primaryForeground` picks whichever of
  `background`/`foreground` contrasts harder against `primary`'s own
  lightness (not "background if primary's light" — that assumes background
  is the dark one, which inverts on a light theme).

Applying and editing the theme are two separate components now, both
reading/writing the same `useStorage("wigl_theme", …)`/`("wigl_theme_knobs",
…)` keys so neither owns the state exclusively:

- **`ThemeEffect`** (`theme/ThemeEffect.tsx`) does nothing but apply — a
  `useLayoutEffect` that runs on every theme id/knobs change. Desktop.tsx
  mounts it unconditionally (no props to toggle), so the applied theme stays
  correct on load and on every change whether or not Settings is open.
- **The Appearance section** (`settings/sections/appearance.tsx`) is the UI —
  a grid of preset swatch cards plus the `Custom` hue-dial/filter editor,
  rendered inside the general Settings modal (`settings/SettingsModal.tsx`,
  opened via right-click → Settings). Picking a preset or `Custom` reads from
  `PRESETS`/`generateParametricColors` respectively; hue dials render over
  their own rainbow gradient track instead of the default fill-style
  indicator (a fill reads as "amount", which a hue isn't).

## The one hard rule for widgets

**A widget never hardcodes a color.** No `bg-white/10`, `border-black/20`,
`text-red-400` — always the semantic Tailwind token that maps to a
`ThemeColors` key (`bg-accent`, `border-border`, `text-destructive`,
`ring-ring`, `bg-primary text-primary-foreground`, ...). This is the entire
point of the theme system: swap a preset or drag a dial, and *every* widget
updates together, including hover states and scrim overlays — not just
whatever literally says `background`. Some existing widgets already follow
this; skim one before adding a new color class. A raw white/black opacity
class in a widget is a bug, not a style choice — fix it the same way, don't
special-case it.

## `wiglAccent`

`wiglAccent` maps straight to `--wigl-accent` like every other token — the
anchor field (`Desktop.tsx`) reads it via `var(--wigl-accent)` in its SVG
(`stopColor`, `stroke`, `drop-shadow`), not through JS, so there's no
format constraint beyond being a valid CSS color.

## Extending this

- **New preset**: add an entry to `PRESETS` in `presets.ts`. Nothing else
  changes.
- **New derived token in the parametric engine**: extend
  `generateParametricColors` — the `ThemeColors` return type forces you to
  keep supplying every existing key too. Prefer deriving it from the
  existing hue dials/filters over adding a new knob — the whole point is
  staying at "a couple of controls that reshape everything", not growing
  back toward one knob per var.
- **New root knob** (a 4th dial, a different filter, a different color
  model): change `ParametricKnobs` and the formulas in `parametric.ts`;
  `ThemeEffect`'s apply plumbing, `applyTheme`, and every widget are
  untouched, since they only ever see the resulting `ThemeColors`. The
  Appearance section does need a new slider row to expose it, same as the
  existing `HUE_FIELDS`/`FILTER_FIELDS` entries.
- **Verifying a change**: switch themes live in the Settings modal (right-
  click → Settings → Appearance) and drag brightness/contrast across their
  full range, including past the midpoint into a light theme — a hardcoded
  color anywhere only becomes visible this way, not from reading the diff.
