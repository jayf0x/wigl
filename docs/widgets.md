# Adding or editing a widget

## Philosophy (shadcn-style)

Widgets and shared components are **owned code**, not framework surface. A component's API is children + `className` (merged via `cn()` from `@/lib/utils`), not a prop for every conceivable variation — if a widget needs the header green, it passes `className="bg-green-950"`, it doesn't wait for a `background` prop to be added. When a shared component doesn't fit, edit it or don't use it; never grow a config system around it.

## A widget is one folder

The entire contract, typed by `WidgetModule` in `src/wigl/types.ts`:

```
src/widgets/<name>/
  index.tsx        ← default-exports the component
                     optionally exports `windowConfig` (size / first-launch x,y / title)
  use<Name>.ts     ← only if it fetches data (see below)
  <name>.config.ts ← only if it has tunable constants
```

`src/App.tsx` discovers folders with `import.meta.glob("./widgets/*/index.tsx")` at build time and opens one OS window per folder at launch — the folder name becomes the window label (so don't name a folder `main`; that's the hidden bootstrap window). **Adding a widget = creating the folder. Deleting it = removing the folder. No registration, no config edits, nothing else.**

```tsx
// src/widgets/clock/index.tsx — a complete, working widget
import { Widget, WidgetHeader, type WidgetWindowConfig } from "@/wigl";

export const windowConfig: WidgetWindowConfig = { width: 200, height: 90, x: 640, y: 40 };

export default function ClockWidget() {
  return (
    <Widget>
      <WidgetHeader>
        <span className="px-1 text-[10px] tracking-widest opacity-40">CLOCK</span>
      </WidgetHeader>
      {/* body */}
    </Widget>
  );
}
```

`windowConfig` is optional — omit it and you get 260×320 at an auto-offset position. `x`/`y` are only the first-launch position; `tauri-plugin-window-state` persists wherever the user drags the window after that. Pick defaults that don't overlap other widgets'. Standard window chrome (transparent, undecorated, always-on-bottom, skip-taskbar, non-resizable) is applied by the spawner in `App.tsx`, not per widget — a widget that needs *different* chrome is no longer "just another widget" and is worth a second thought.

No capability edit needed either — `src-tauri/capabilities/default.json`'s `windows` field is a `["*"]` glob, so new window labels are covered automatically. You only touch that file for new *permissions* (see "Running shell commands" below).

## What a real-data widget needs

Looking at `src/widgets/repos/` as the reference shape (the repo-status widget — its name describes what it does, not "the app"; see `docs/architecture.md`'s naming note):

1. **A config module** (`src/widgets/repos/reposWidget.config.ts`) — plain exported constants for anything you might want to tweak (poll interval, source paths). No env vars, no settings UI, no runtime config loading.
2. **A data hook** (`src/widgets/repos/useReposWidget.ts`) — owns the `setInterval` + shell-command + `useState` cycle described in `docs/architecture.md`. One hook per widget; don't share it across widgets, don't generalize it into a "data fetching framework." Don't add this until there's actually external data to fetch — the todo widget has neither a hook nor a config yet, because it has nothing to fetch or tune.
3. **The component** (`src/widgets/repos/index.tsx`) — consumes the hook, renders rows/state, wires up interactions. Wrapped in `Widget`/`WidgetHeader` (below).
4. **Import with the `@/` alias**, not relative paths, for anything outside the widget's own folder (`@/wigl`, `@/components/ui/button`). Within a widget's own folder, relative imports (`./useReposWidget`) are fine.

## Panel chrome (`Widget` / `WidgetHeader`)

`@/wigl` (barrel over `src/wigl/`) exports the two shared pieces, both children + `className` only (see "Philosophy" above):

- **`Widget`** — the dark rounded panel (also forces the `dark` class coss ui needs). Override looks via `className`.
- **`WidgetHeader`** — a drag handle, and *only* a drag handle. Its single job is making window-drag and clicking coexist: mousedown on anything interactive (`button, a, input, select, textarea`, or any element carrying `data-no-drag`) passes through to the element; mousedown anywhere else starts the window drag. Content is whatever children you pass — a title span, status info, buttons (`ml-auto` to right-align them), nothing at all. **Never** attach `onMouseDown`/`stopPropagation` workarounds inside it, and don't import `src/wigl/drag.ts` in a widget — if a click is being eaten, add `data-no-drag` to that element instead.

```tsx
<WidgetHeader className="bg-emerald-950/40">
  <span className="px-1 text-[10px] tracking-widest opacity-40">REPOS</span>
  <div className="ml-auto flex items-center gap-0.5">{/* buttons — clicks just work */}</div>
</WidgetHeader>
```

## Persistent storage (`useStorage`)

```ts
import { useStorage } from "@/wigl";
const [events, setEvents, { loading }] = useStorage<Event[]>("calendar_events", []);
```

`src/wigl/storage.ts` — useState persisted as a JSON blob in a kv table in `~/Library/Application Support/wigl/wigl.db`, via macOS's built-in `sqlite3` CLI (no Rust, no Tauri plugin — same "shell out to a real CLI" rule as data fetching). Writes are optimistic; external changes (another window, a CLI script) are picked up by a 3s poll. Keys must match `[a-zA-Z0-9_-]+`.

External tools can write the same data: `scripts/calendar.ts` (run as `bun run calendar:add "2027-12-12" "some event" [HH:MM] [description]`, `calendar:list`, `calendar:rm <id-prefix>`) uses `bun:sqlite` against the same DB file and key, and an open calendar widget sees the change within a poll. If you build a CLI for another widget's data, copy that shape: same DB path, one kv key, JSON blob, `CREATE TABLE IF NOT EXISTS kv (...)` before use — the key name is the whole contract between widget and CLI, so keep it in one exported constant on the widget side and reference it in the CLI comment.

Ceiling to know about: last-writer-wins on the whole blob — two writers mutating the same key within one poll window can drop a write. Fine for single-user widget data; if that ever bites, move that key to its own table with row-level writes.

## Running shell commands from a widget

Use `Command.create(name, args)` from `@tauri-apps/plugin-shell`, e.g.:

```ts
import { Command } from "@tauri-apps/plugin-shell";
const output = await Command.create("git", ["status"]).execute();
```

The `name` here (`"git"`) must match a `name` entry under `shell:allow-execute` in `src-tauri/capabilities/default.json`, which maps it to an actual binary (`cmd`) and an args policy. **New binary → new capability entry**, or the call fails silently or with a permission error at runtime (check via `log show`, not visually — see `docs/debugging.md`). If you need a whole pipeline (multiple commands, conditionals), it's usually simpler to write one `sh -c "..."` script string (see `scanScript` in `useReposWidget.ts`) than to orchestrate multiple `Command.create` calls from JS.

`cmd` can be a fixed absolute path, not just a bare binary name — e.g. `openInEditor` in `useReposWidget.ts` calls the bundled VS Code CLI at its full app-bundle path (`name: "code"`, `cmd: "/Applications/Visual Studio Code.app/.../bin/code"`) rather than relying on `$PATH`, since GUI apps launched outside a shell often have a minimal `PATH` that doesn't include user-installed CLI tools. Prefer passing args as an array (`Command.create("open", ["-a", "X", path])`) over interpolating a path into a shell string — it sidesteps shell-quoting/injection entirely for the common case, only reach for `sh -c` when you genuinely need shell features (pipes, conditionals, `||` fallback chains).

## Icons

Use `lucide-react` (already a dependency, pulled in by the coss ui init) rather than emoji glyphs — crisper at small sizes, themeable via `currentColor`/`fill`, and consistent with coss ui's own icon usage. Check the icon name actually exists before importing it: `ls node_modules/lucide-react/dist/esm/icons/ | grep <keyword>` — names sometimes differ from what you'd guess (e.g. it's `TriangleAlert`, not `AlertTriangle`, as the primary export; both exist but one is an alias).

## Styling

Tailwind utility classes directly in JSX. No CSS modules, no styled-components.

For real UI primitives (tables, dialogs, form controls — anything beyond what a few div/flex utility classes reasonably express), use **coss ui** (`coss.com/ui`, aka `@coss/*`), a copy-paste component set built on Base UI + Tailwind v4. It works through the `shadcn` CLI:

```bash
bunx shadcn@latest add @coss/<component>   # e.g. @coss/table, @coss/dialog, @coss/select
```

This drops a real `.tsx` file into `src/components/ui/`, which you own and can edit like any other file — it is not a runtime dependency you import from `node_modules`. Component names come from the registry list (`bunx shadcn@latest view @coss/ui` prints it) — note the registry path is `@coss/<name>` (e.g. `@coss/table`), not `@coss/ui/components/<name>`.

Init already ran once (`components.json`, `@/*` path alias in `tsconfig.json` + `vite.config.ts`, `src/lib/utils.ts`, and the design-token theme in `src/App.css`) — you don't need to redo that, just run `add` for whatever component you need. Only pull in a component when a widget actually needs that primitive; don't pre-install the full set "just in case."

`Widget` forces the `dark` class on its root wrapper since coss ui components read their colors from CSS variables scoped to `:root`/`.dark` in `App.css` — without it, coss components render with the light-theme palette regardless of the app's own dark styling. Widgets built via `Widget` get this for free; don't re-add `dark` on anything inside it.

## Window chrome

The standard flags (transparent, undecorated, no shadow, always-on-bottom, skip-taskbar, non-resizable) live in one place: the spawner in `src/App.tsx`. `src-tauri/tauri.conf.json` only declares the hidden `main` bootstrap window. App-level prerequisites, set once: `macOSPrivateApi: true` in `tauri.conf.json` (required for transparency) and the matching `macos-private-api` Cargo feature in `src-tauri/Cargo.toml`.

## Checking a widget's own re-renders

`bun run tauri dev` runs `src/main.tsx`'s dev-only `react-scan` overlay inside every widget's WebView (see `docs/architecture.md`'s "Render isolation" — this is for spotting waste inside *one* widget's own render tree; there is no cross-widget re-render leakage to check for, since each widget is a separate JS realm by construction). It's gated behind `import.meta.env.DEV`, so it's entirely absent from `bun run build`/`bun run tauri build` output — no prod bundle-size cost, nothing to remember to strip out.
