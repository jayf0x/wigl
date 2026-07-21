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
        useTheme (hooks/useTheme.ts)
                    ↓
        applyTheme (theme/applyTheme.ts)
                    ↓
        CSS custom properties on :root
                    ↓
        Tailwind utility classes (bg-primary, border-border, ...)
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
- **Parametric** (`parametric.ts`): 3 opaque colors (`a`/`b`/`c`, no semantic
  names) plus 3 numeric elevation sliders (`cardElevation`,
  `surfaceElevation`, `accentElevation`) run through OKLCH formulas to derive
  all ~18 tokens. Knob `a`'s own lightness decides light-vs-dark for the
  whole set — every formula reads `background`'s lightness and flips
  direction accordingly (see `isDarkBg` in that file), so dragging `a` toward
  white doesn't strand one pale rectangle in an otherwise-dark theme.
  The elevation sliders exist because hand-written presets don't agree on
  sign: Nord/Gruvbox step `card` *lighter* than `background`, Dracula/
  Catppuccin step it *darker* — a hardcoded fraction can't fit both, so the
  step itself (and its sign) is a knob. `primaryForeground` is derived as
  `background`/`foreground` directly (not a flat gray), matching what every
  hand-written preset already does.

`useTheme` picks between them based on the persisted theme id
(`CUSTOM_THEME_ID` → parametric + persisted knobs, anything else → a
`PRESETS` lookup) and calls `applyTheme`. `ThemeSettingsPopover` is the only
UI: preset list + the 3 knob color pickers + the 3 elevation sliders, shown
when `Custom` is selected.

## The one hard rule for widgets

**A widget never hardcodes a color.** No `bg-white/10`, `border-black/20`,
`text-red-400` — always the semantic Tailwind token that maps to a
`ThemeColors` key (`bg-accent`, `border-border`, `text-destructive`,
`ring-ring`, `bg-primary text-primary-foreground`, ...). This is the entire
point of the theme system: swap a preset or drag a knob, and *every* widget
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
  keep supplying every existing key too.
- **New root knob** (a 4th input, or a different color model): change
  `ParametricKnobs` and the formulas in `parametric.ts`; `useTheme`,
  `applyTheme`, and every widget are untouched, since they only ever see the
  resulting `ThemeColors`.
- **Verifying a change**: switch themes live in the settings popover and
  drag the custom knobs across the full lightness range — a hardcoded color
  anywhere only becomes visible this way, not from reading the diff.
