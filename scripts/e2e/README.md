# widgets-root e2e suite

Proves the widget CLI (`scripts/widget.ts`) isn't secretly coupled to
`wigl-widgets/` living inside this repo — that a widget folder built,
typechecked, and installed from some other location on disk behaves exactly
like one built in place. This was a real, previously-untested assumption:
the first run of this suite caught two genuine bugs (both now fixed in
`scripts/widget.ts`):

1. **Typechecking a widget outside the repo failed** — `tsc` resolves bare
   `"react"`/`"react/jsx-runtime"` by walking up through ancestor
   `node_modules`, which only found this repo's `@types/react` because
   `wigl-widgets/` happened to live inside it. `widget:devkit` (below) now
   vendors the exact `@types/react` + `csstype` this repo is pinned to
   alongside the exported `tsconfig.json`/`types/`, so an external root is
   self-contained.
2. **The no-arg `widget:install` sweep tried to build `node_modules/` as a
   widget** — it walked every directory directly under the widgets root, and
   a devkit-seeded `node_modules/` at that same root qualified. Fixed by
   adding `"node_modules"` to `NON_WIDGET_DIRS` in `scripts/widget.ts`
   (same reservation `"types"` already had).

## Running it

```bash
bun run wigl test e2e     # only this suite
bun run wigl test         # everything: widgets + shared + e2e
bun test scripts/e2e      # same suite, bypassing the wigl dispatcher
```

Slower than the rest of the repo's tests (low single-digit seconds, not
milliseconds) — it shells out to real `tsc`, `Bun.build`, and the `widget`
CLI as subprocesses against a real temp filesystem. No mocking of fs, tsc,
or Bun.build; every assertion is on a real exit code or a real file on disk.

## How a scenario is built

1. `beforeAll` calls `widget:devkit` **once** into a shared temp dir — it
   regenerates `wigl-widgets/types/` (`tsc -p tsconfig.types.json`) and
   copies `tsconfig.json` + `types/` + the react type deps there. This is
   the expensive step, so it's shared across every scenario rather than
   re-run per test.
2. Each `test()` calls `makeScenarioRoot(devkitDir, [fixtureNames])`
   (`helpers.ts`), which builds a **fresh** temp dir per scenario: a copy of
   the shared devkit output, plus a copy of each named fixture from
   `fixtures/`. Fresh per scenario so one test's build/install can't leak
   state into another's.
3. The test drives `bun scripts/widget.ts <cmd>` as a real subprocess
   (`runWidgetCli`) against that root, with `WIGL_WIDGETS_ROOT` and/or
   `WIGL_APP_DATA_DIR` pointed at temp dirs — the latter means **no test
   here ever touches the real app's installed plugins**, regardless of what
   scenario runs.
4. `afterAll` removes every temp dir `makeTempDir`/`trackTemp` created.

## The two env vars this suite exercises

Both are read by `scripts/widget.ts` and only matter when set — normal
`bun run widget:*` usage from this repo is unaffected:

- **`WIGL_WIDGETS_ROOT`** — overrides the no-arg "every widget" sweep root
  (default `wigl-widgets`). `widget:build <dir>`/`widget:install <dir>`
  already accepted any path, in or out of the repo, with no override needed
  — this only affects the no-arg forms.
- **`WIGL_APP_DATA_DIR`** — overrides where `widget:install`/`list`/`rm`
  read and write (default: the OS's real Tauri app-data dir). Exists
  specifically so tests (and anyone experimenting) can install/list/remove
  without touching the real app's plugin set.

## Extending this suite

- **New fixture** — add a folder under `fixtures/`, matching the shape a
  real `wigl-widgets/<name>/` folder has (an `index.tsx` is enough; add
  `package.json` if the scenario needs permissions or a custom entry). Give
  it a doc comment explaining what it's supposed to prove and which stage
  (typecheck / build / check / install) it's meant to fail at, if any — see
  the existing fixtures for the pattern.
- **New scenario** — add a `describe`/`test` block in
  `widgets-root.test.ts`, build a root via `makeScenarioRoot`, drive it with
  `runWidgetCli`/`typecheck` from `helpers.ts`. Don't reach for `Bun.spawn`
  directly in a test — route through the helpers so every scenario stays
  consistent about cwd, env, and cleanup tracking.
- **New CLI command to cover** — if `scripts/widget.ts` grows a new
  subcommand, add a scenario here exercising it against an external root
  before considering it done; that's the whole point of this suite existing
  as a separate thing from `wigl-widgets/*/tests/`.

## Platform scope

This suite (and the `scripts/widget.ts` commands it drives — `build`,
`install`, `check`, `list`, `rm`, `devkit`) is plain Bun/TypeScript using
`node:fs`/`node:path` and `Bun.spawn`/`Bun.build` — no shell scripts, no
macOS/Linux-only APIs — and is expected to pass on Windows as well as macOS
and Linux. This is narrower than it sounds: it's the widget **authoring**
tooling, not the Tauri desktop app itself. `bun run verify`/`qa`
(`scripts/verify.sh`/`qa.sh`) and the actual GUI (window chrome, drag,
click-through — `src-tauri/src/lib.rs`, `src/wigl/Desktop.tsx`) remain
macOS + Linux only per `AGENTS.md`'s hard rules; nothing here changes that.
