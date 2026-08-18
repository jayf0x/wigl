# Settings UI — plan

Research + architecture plan for a general Settings modal, replacing the
current state where the only configurable thing is theme (via
`ThemeSettingsPopover`) and everything else (`grid/config.ts`, widget/storage
paths, the widget CLI) is either a source file or a terminal command.

Not built yet. This file is the plan; execution is a single session (see
"Scope" below) plus one clearly separate follow-up feature.

## Current state (what exists today)

- **Right-click → Settings** already exists (`Desktop.tsx`'s `settingsAction`,
  registered via `useRegisterGlobalAction`) but it opens `ThemeSettingsPopover`
  directly — Settings *is* theme today. No general modal exists.
- **Theme** (`src/wigl/theme/`, `ThemeSettingsPopover.tsx`) is the proof of
  concept for this whole feature: preset list + a "Custom" parametric editor,
  persisted via `useStorage("wigl_theme", …)` / `useStorage("wigl_theme_knobs", …)`,
  applied live via `applyTheme()`. It proved the pattern — that doesn't mean
  it's done. Its layout/interaction is fair game to improve as part of
  folding it into the general modal, not just relocate verbatim.
- **`useStorage`** (`src/wigl/hooks/useStorage.ts`) is a SQLite-kv-backed
  `useState` — optimistic writes, cross-window sync via a broadcast event
  (each monitor is its own JS realm/window, so this is what makes a theme
  change on one screen show up instantly on the other), cross-process pickup
  via 3s polling. This is the live tier (see "Storage" below).
- **`src-tauri/src/lib.rs`** has one file-backed settings-adjacent mechanism
  today: `secrets.json` in `app_data_dir()`, chmod 600, atomic tmp+rename.
  Precedent for "a JSON file, written natively for atomicity" that this plan
  reuses.
- **`grid/config.ts`** (`TILING`) is a plain exported `const`, imported
  directly by `grid/math.ts` and `Desktop.tsx`. Not read from storage, not
  user-editable, requires a rebuild to change.
- **Widgets root** (`wigl-widgets/`) only matters to `bun run widget:*`
  (`scripts/widget.ts`, via `WIGL_WIDGETS_ROOT` env var) — the running app
  never reads it; it only sees *installed* plugins under
  `app_data_dir()/plugins/`, found by directory listing
  (`src/wigl/plugins/loader.ts`'s `pluginsDir()`).
- **Storage DB path** is wherever Tauri's platform convention puts
  `app_data_dir()` — not independently configurable today.
- **The widget CLI** (`scripts/widget.ts`) is a plain `switch/case` over
  `build | install | list | rm | devkit | check` — not a declarative command
  table today, so a dynamic UI mapping is a real (small) refactor, not free.
- **Plugin permission model** (`src/wigl/plugins/{types,registry}.ts`) has
  5 permissions, declared per-widget in `package.json`'s `wigl.permissions`.
  No precedent for a widget registering *settings fields* — new in this plan.
- **`wigl-widgets/widget.schema.json`** is the existing precedent for "a JSON
  Schema file that exists purely for editor autocomplete via a `$schema`
  key" — not runtime-validated by any code today. The new config file
  follows the same pattern rather than pulling in a validation library.

## Vision, restated precisely

1. Right-click → **Settings** opens one centered, modest-width, `overflow-y`
   modal. Theme becomes one (improved) section inside it — "Appearance."
2. Sections are backed by a **declarative schema**: a list of fields, each
   saying how to read it, write it, and search it. One-off UI (hue dials)
   stays hand-built but still registers into the same schema for search.
3. A **search box** filters the flattened field list by label/keywords —
   plain substring match, no fuzzy-search dependency.
4. The **widget CLI gets a dynamic UI mapping** — the Widgets section
   renders itself from whatever the CLI's command table currently exposes,
   so a new CLI command shows up without a UI-side change. "Install from a
   GitHub URL" is new CLI capability that doesn't exist yet — it's explicitly
   out of this plan's scope (see "Deferred").
5. **Widgets can contribute their own settings section**, opt-in, via a new
   `useRegisterSettings` hook — proved with a minimal real POC in the `todo`
   widget (see below), not just described.

## Storage — one config file, plus the existing live tier

Two tiers, not more, and each has exactly one mechanism:

**Tier 1 — live, `useStorage` (SQLite kv), already exists.** Anything that
should apply instantly and sync across windows without a restart: theme
(today), and the new `useRegisterSettings` POC toggle in the `todo` widget.
No new mechanism needed — this tier is done, just gets more callers.

**Tier 2 — one config file, restart required, new.** Everything that used
to be a hardcoded `const` in a source file — `TILING`, widgets-root path,
storage-path if made configurable, and any future setting of the same
shape — becomes a **default baked into one JSON file's schema**, overridable
by the user. Concretely:

- `app_data_dir()/wigl-config.json` — one file, sibling of `secrets.json`
  and `plugins/`, holding every Tier-2 setting as a flat/namespaced object.
  Each owning module (`grid/config.ts`, a future `paths/config.ts`) still
  exports its compile-time default; the config file only holds *overrides*,
  merged over those defaults at startup the same way theme knobs already
  merge over `DEFAULT_KNOBS` (`{ ...DEFAULT_KNOBS, ...knobs }`) — one
  familiar pattern, not a new one.
- `app_data_dir()/wigl-config.schema.json` — a JSON Schema for editor
  autocomplete only, same role as `wigl-widgets/widget.schema.json` today.
  Not runtime-validated by a library; TypeScript types + the merge-over-
  defaults pattern are the actual safety net, matching this repo's existing
  bar (no `ajv`/`zod` dependency to add).
- Read/write via two small Rust commands mirroring `secrets.json`'s
  read/write/atomic-tmp-rename shape in `lib.rs` — reusing that precedent
  rather than re-deciding "shell vs. Rust" for a nearly-identical file.
- **Tier 2 is always restart-required, by rule — no per-field flag, no
  live-mutation attempt.** This is a deliberate simplification: it resolves
  the open question the earlier draft of this plan had about whether
  mutating `TILING` in place safely re-triggers grid layout — it doesn't
  need to, because Tier 2 never applies live. If a field turns out to need
  Tier 1 behavior later, it moves to `useStorage`, it doesn't get a
  special case here that has to be spiked and unit tested. Simpler
  invariant, no ambiguity.

### Restart flow

Add `@tauri-apps/plugin-process` (an official Tauri plugin, same category
as the already-used `plugin-shell`/`plugin-opener` — not custom Rust, not a
shell one-liner trying to kill-and-relaunch itself, which is exactly the
kind of thing that plugin exists to do correctly cross-platform). Any
Tier-2 field change shows a small "Restart wigl to apply" banner in the
modal with a button that calls `relaunch()`. No auto-restart on change —
a widget mid-edit (LocalCode mid-session, a form draft) shouldn't lose
state to a settings tweak elsewhere; the user decides when to take the hit.

## Architecture

### New shared module: `src/wigl/settings/`

Internal to `src/wigl`, not a 4th public barrel — AGENTS.md is explicit
about exactly three (`@/wigl`, `@/wigl/hooks`, `@/wigl/utils`). The one
widget-facing piece (`useRegisterSettings`) gets re-exported from the
existing `@/wigl/hooks` barrel, same as `useRegisterGlobalAction` today.

```
src/wigl/settings/
  types.ts             // SettingField, SettingSection, storage-binding kinds
  registry.ts           // section registration + flatten-for-search, mirrors plugins/registry.ts
  config.ts               // Tier-2 read/write + defaults-merge, wraps the Rust commands
  SettingsModal.tsx         // modal shell: search box, section list, overflow-y body, restart banner
  sections/
    appearance.tsx           // today's ThemeSettingsPopover content, migrated + improved
    grid.tsx                   // TILING fields (Tier 2)
    storage.tsx                  // paths (Tier 2), "open data folder", "clear cache"
    widgets.tsx                    // installed widgets + CLI-mapped actions (dynamic, see below)
```

`SettingField` sketch (illustrative, not final):

```ts
type StorageBinding =
  | { kind: "kv"; key: string }               // useStorage — Tier 1, live
  | { kind: "config"; key: string }            // wigl-config.json — Tier 2, restart required
  | { kind: "action"; run: () => Promise<void> }; // CLI-mapped button, not a value

interface SettingField {
  id: string;
  label: string;
  keywords?: string[];
  control: "toggle" | "slider" | "select" | "text" | "action" | "custom";
  binding: StorageBinding;
}
```

Each owning module exports its own section next to its config (`grid/config.ts`
gains a sibling `grid/settings.ts` exporting `TILING`'s `SettingSection`) so
schema and the thing it configures stay one edit apart. `settings/registry.ts`
only aggregates; it doesn't define fields itself except for settings-native
chrome (search, modal shell).

### The modal

- Rendered in `Desktop.tsx` where `ThemeSettingsPopover` is today — same
  "always mounted, prop toggles visibility" pattern, so live-apply-on-change
  keeps working unconditionally for Tier 1 fields.
- Centered, modest max-width, `overflow-y-auto` body — a real dialog, not
  anchored to the right-click point like today's popover.
- Left rail or top tabs for sections (implementation detail, not decided
  here); search box filters the flattened field list across all sections.

### Widget-contributed settings — `useRegisterSettings`

New hook, `useRegisterSettings(section: SettingSection)`, exported from
`@/wigl/hooks` next to `useRegisterGlobalAction` — same register-on-mount/
unregister-on-unmount shape, same permission gating (no new permission
needed: a widget that can render at all can already show its own UI, this
just gives it a second, centralized place to put it). Backed by Tier 1
(`useStorage`) only — a widget's own settings are exactly the kind of thing
that should apply live, matching the POC below.

**POC target: the `todo` widget.** Register one boolean field ("Highlight
background") that flips the widget's own background between its normal
transparent state and red, via `useStorage` under a `todo:`-prefixed key
(the registry's existing per-widget key-prefix convention). Deliberately
trivial — it isn't validating a UX, it's validating that a widget can
register a field, have it show up searchable inside the general Settings
modal, and see the change reflected in its own rendering live. Once this
round-trips, the mechanism is proved for real future widget settings
(Ollama port, auto-rename toggles, etc. — explicitly not built now, just
unblocked).

### Widget CLI → dynamic UI mapping

1. Extract a declarative command table in `scripts/widget.ts` — `{ id,
   label, args, run }` per command — that the existing `switch` dispatches
   from, so CLI behavior is unchanged but introspectable.
2. `sections/widgets.tsx` renders itself from that table (import at build
   time, or a thin `widget:list-commands` JSON output the section reads) —
   whatever commands exist is what shows, no hardcoded per-command button.
   `list`/`rm`/clear-cache are in scope now: real commands, real UI, driven
   through `runCmdStreaming` the same way LocalCode already drives
   `opencode serve` (AGENTS.md rule 3 — shell out, don't reimplement).
3. **"Install from a GitHub repo" is genuinely new CLI capability** (clone,
   validate the folder shape, run the existing build/install path on it) —
   see "Deferred" below. The dynamic-mapping design means this can land
   later as a pure `scripts/widget.ts` change with zero Settings-UI code
   changes, which is the actual payoff of doing it dynamically now.

## Scope: one session

Everything above — `settings/` module, `wigl-config.json` + schema file,
the two Rust commands, the restart-flow plugin, Appearance migration+polish,
Grid section, Storage/paths section, Widgets section (list/remove/clear
cache) with the CLI command-table refactor, and the `useRegisterSettings`
POC in `todo` — is scoped as one session's work, not split across sessions.
Reasonable build order within that session (not separate sessions):

1. `settings/types.ts` + `registry.ts` + empty `SettingsModal.tsx` shell,
   wired into `Desktop.tsx` in place of the direct theme-popover open.
2. Tier 2 plumbing: `wigl-config.json`/schema, the two Rust commands,
   `settings/config.ts`'s defaults-merge wrapper, `plugin-process` restart
   banner — build this before any Tier-2 section needs it.
3. Appearance section (theme migrated + polished), Grid section, Storage
   section — three straightforward consumers of what (1)+(2) built.
4. `scripts/widget.ts` command-table refactor, then Widgets section.
5. `useRegisterSettings` hook + the `todo` widget POC — last, since it
   depends on the modal/registry shape from (1) being stable.

## Deferred (separate feature, not this session)

- **Install a widget from a GitHub URL.** Real CLI feature work (clone,
  validate, build) wearing a UI-task's name — bundling it here risks the
  whole session shipping nothing if the clone/build path turns out messy.
  Becomes a normal `backlog.md` `F` entry once this session's dynamic
  Widgets section exists to host it.

## Doc + backlog follow-ups

- No existing `backlog.md` entry overlaps this work — nothing to rewrite
  there today. "Install from GitHub" becomes a new `F` entry once this
  session ships (not before — `backlog.md`'s rule is "actionable right
  now").
- `docs/widgets.md` gains the `useRegisterSettings` contract and, if the
  CLI table refactor changes how `scripts/widget.ts` is described in
  "Build, install, and the plugin mechanism," that section needs a pass.
- `docs/theming.md` / `docs/architecture.md` get a look after this session,
  per each file's own "keep docs honest" rule, if the popover→modal move
  contradicts anything currently written there.
- No new `docs/settings.md` file — AGENTS.md prefers extending existing
  owners over adding files, and this splits cleanly across
  `docs/widgets.md` (widget-contributed settings) and `docs/architecture.md`
  (the modal itself) if either needs updating at all.
