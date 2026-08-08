# TODO — LocalCode

Deferred/delegated work for the `LocalCode` widget (`wigl-widgets/LocalCode/`)
— a chat UI for driving local coding agents (opencode + Ollama today, Claude
Code later). This file holds only items solvable *right now*, in one
sitting, by an agent with no memory of past sessions — everything else
belongs in `backlog.md` (see that file's own rules). Read
`wigl-widgets/LocalCode/AGENTS.md` first regardless — it has the load-bearing
facts (API shapes, server lifecycle, decisions log) this entry assumes you
already know.

Delete this entry when it's done — this file isn't a changelog.

## Replace the composer's editor with Milkdown (Crepe)

**Decision, made three times now: build Milkdown, not CodeMirror.** A prior
pass built a CodeMirror 6 field instead (`wigl-widgets/LocalCode/components/
CodeMirrorField.tsx` + `composerEditor.ts`, wired into `Composer.tsx`) and
that stands as the *current* implementation — but it is not what was asked
for and is to be **replaced outright**, not kept alongside Milkdown. Delete
`CodeMirrorField.tsx` and `composerEditor.ts`, remove the `@codemirror/*` and
`@lezer/*` entries from `wigl-widgets/LocalCode/package.json`, and rebuild
the editor portion of `Composer.tsx` on Milkdown's **Crepe** editor.

**Why Crepe specifically, not MDXEditor**: the hard requirement is `Tab`/
`Shift+Tab` to nest/unnest a markdown list line, which Milkdown's list
keymap supports natively; MDXEditor's shortcut system doesn't clearly expose
the same interaction. If Crepe's editing feel turns out too
document-editor-ish in practice (test this early, don't assume it from
docs), MDXEditor is the documented fallback — its React API is `markdown`
in, `onChange(markdown)` out, no ProseMirror-keymap integration to fight.

**The blocker that killed this the first two times is gone.** Milkdown/Crepe
requires its own stylesheet, and the plugin bundler used to have no way to
load one — `docs/plugins.md`'s "CSS" section now documents a real mechanism:
a plugin's own `import "./x.css"` gets bundled, installed, and injected as a
`<style>` tag by the host. This is confirmed working end-to-end (build →
install → runtime injection), not theoretical.

**What still has to happen, because the CSS pipeline only carries a
stylesheet through — it doesn't write one**: Crepe's built-in visual themes
ship as a sheet of literal hardcoded colors, which `docs/theming.md` bans
for widgets outright (no widget may hardcode a color; every color must be a
`var(--token)` semantic token so theme presets/parametric changes apply to
it). Do not import Crepe's shipped theme CSS as-is. Instead write a small
custom stylesheet for the composer (e.g.
`wigl-widgets/LocalCode/components/composer.css`, imported from
`Composer.tsx` or wherever the Crepe instance mounts) that styles Crepe's
DOM structure using wigl's own tokens (`var(--foreground)`,
`var(--muted-foreground)`, `var(--primary)`, `var(--border)`, `var(--ring)`,
`var(--accent)`, `var(--accent-foreground)` — the full list is
`src/wigl/theme/types.ts`'s `THEME_COLOR_KEYS`). Check Crepe's own CSS
(inspect the installed `@milkdown/crepe` package, or its DOM at runtime) to
find which class names need overriding — don't guess selectors.

**Feature surface — strip Crepe down, don't take it as shipped.** This is a
chat composer, not a document editor. Use Crepe's `Crepe.Feature` config to
disable: `Toolbar`, `Table`, `ImageBlock`, `BlockEdit`, `Latex`, `TopBar`,
`AI`, and (at least initially) `CodeMirror` — embedding CodeMirror's own
code-block support inside Crepe risks reintroducing the exact bundle-bloat
problem the CodeMirror pass just fixed (`@codemirror/language-data`'s
per-language grammars can't be code-split by this repo's single-file plugin
bundler; keep fenced code as plain monospace unless this is deliberately
re-evaluated with the bundle size checked before/after). Keep `ListItem` and
`Placeholder`. Verify the actual `Crepe.Feature` flag names against the
installed package/milkdown.dev docs at implementation time — not verified
live in this repo as of writing this entry.

**Keyboard ownership — the hard part.** `Composer.tsx`'s slash-command
palette (`/model`, `/agent`, `/think` — see `commands.ts` and
`wigl-widgets/LocalCode/AGENTS.md`'s "UI shape" section for why this exists
instead of dropdowns) must keep working: when the palette is open, its own
arrow/Tab/Enter/Escape handling must win over whatever Milkdown/ProseMirror
binds to those same keys by default. This needs a ProseMirror keymap
registered at higher precedence than Milkdown's own list keymap (Milkdown
wraps ProseMirror — check milkdown.dev's plugin/keymap docs for the current
API to inject one; do not guess at exact call names here). Preserve the
existing hard contract unchanged: **Enter never submits** (it inserts a
paragraph, or continues/exits a list item); **⌘/Ctrl/⌥+Enter sends**.

**Markdown is still the only source of truth.** `Composer.tsx` currently
holds the composer's content as a plain string (`text` state) and runs
`parseCommand(text)`/`filterOptions(...)` from `commands.ts` against it
unchanged — that parsing logic needs no changes. Wire Crepe's
markdown-change listener (its React integration exposes one — check current
docs) to keep that same string in sync on every edit, the same role
`CodeMirrorField`'s `onChange` played before.

**Acceptance checklist** (walk all of these manually before calling this
done — this is exactly the list the original research proposed and none of
it was verified against a real build):

1. Typing `- ` at line start starts a bullet list; `1. ` starts a numbered one.
2. `Tab` on a list line nests it under the previous item; `Shift+Tab` un-nests.
3. `Enter` on a non-empty list item continues the list; `Enter` on an empty one exits it.
4. Pasting real markdown and pasting plain text both behave sensibly.
5. `Shift+Enter` inserts a soft line break, not a new paragraph.
6. The blinking cursor is visible against every wigl theme, including a dark one — CodeMirror's own cursor was invisible-black here for exactly this reason (see `wigl-widgets/LocalCode/AGENTS.md`'s CodeMirror decision-log entry) and Crepe/ProseMirror needs the same check, not an assumption it's fine.
7. The slash palette opens on `/`, its own arrow/Tab/Enter/Escape handling works while open, and it doesn't leak into the document when closed.
8. `⌘/Ctrl/⌥+Enter` sends; plain `Enter` never does.
9. No hardcoded color anywhere in the new composer CSS — check by switching wigl themes live and dragging brightness/contrast across their full range (`docs/theming.md`'s own verification method), not by reading the stylesheet.

**Then verify the usual way**: `bun run typecheck`, `bun run build`,
`bun run plugin:check wigl-widgets/LocalCode`, `bun run plugin:install
wigl-widgets/LocalCode`, and `bun run verify` before calling this done.
Check the built plugin size (`bun run plugin:build wigl-widgets/LocalCode`
prints it) against the CodeMirror-era ~3.8MB — a large regression is worth
noting, not silently accepted.

**Update `wigl-widgets/LocalCode/AGENTS.md`'s "UI shape" section** to
describe the shipped result in place of its current CodeMirror entry — same
rule as always: the doc describes what's actually running, not history.
