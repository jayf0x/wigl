Continue `todo-settings-ui.md`. The modal skeleton is done and merged: `src/wigl/settings/`
(types.ts, registry.ts, SettingsModal.tsx, sections/appearance.tsx), `theme/ThemeEffect.tsx`
(theme apply, split out of the old ThemeSettingsPopover), `useRegisterSettings` exported from
`@/wigl/hooks`, and a POC section in `wigl-widgets/todo`. Read `docs/theming.md` and the
"Contributing a Settings section" part of `docs/widgets.md` for how the pieces already fit
together before changing them.

Not built yet, still true to the plan's "Scope: one session" list:

1. **Tier 2 storage**: `app_data_dir()/wigl-config.json` + `.schema.json`, the two Rust
   read/write commands (mirror `secrets.json`'s atomic tmp+rename in `src-tauri/src/lib.rs`),
   `settings/config.ts`'s defaults-merge wrapper, and the `@tauri-apps/plugin-process` restart
   banner. Build this before either of the next two sections — they depend on it.
2. **Grid section** (`grid/config.ts`'s `TILING` fields) and **Storage section** (paths, "open
   data folder", "clear cache") — straightforward consumers of (1), same shape as
   `sections/appearance.tsx`.
3. **Widgets section**: extract a declarative `{ id, label, args, run }` command table in
   `scripts/widget.ts` that the existing `switch` dispatches from, then have
   `sections/widgets.tsx` render itself off that table (`list`/`rm`/clear-cache only — "install
   from a GitHub URL" is explicitly deferred, see the plan's "Deferred" section).

Do them in that order — each later one leans on the one before it. If you only get through
part of this list, that's fine; leave the rest as-is for whoever picks it up next, same as this
note describes it now.

One live gotcha already found and fixed once, worth knowing before you add a second
`useStorage` reader on a new key: two `useStorage` hook instances on the *same key* in the
*same window* used to only sync via the 3s poll fallback, not the instant broadcast — looked
like "the UI is broken" when it was really just lag. Fixed in `useStorage.ts`'s listener (see
git history) — the fix is already in, just don't reintroduce a same-window sender filter if
you touch that file.
