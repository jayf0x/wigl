/**
 * Proves the widget CLI (scripts/widget.ts) isn't secretly coupled to
 * wigl-widgets/ living inside this repo — see ./README.md for the full
 * story. Every scenario below builds a real external "widgets root" in a
 * temp dir (no fixture ever runs from inside wigl-widgets/), drives the real
 * `bun scripts/widget.ts <cmd>` subprocess against it, and asserts on real
 * exit codes / real files on disk. No mocking of fs, tsc, or Bun.build.
 *
 * Run: `bun run wigl test e2e` (or `bun test tests/e2e`). Slower than the
 * unit-style suites elsewhere in the repo — it shells out to `tsc` and
 * `Bun.build` for real — expect low-teens seconds, not milliseconds.
 */

import {
  cleanupTemp,
  exportDevkit,
  makeGitFixtureRepo,
  makeScenarioRoot,
  makeTempDir,
  readInstalled,
  runWidgetCli,
  runWidgetCliFrom,
  typecheck,
} from "./helpers";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { join } from "node:path";

const exists = (p: string) =>
  access(p)
    .then(() => true)
    .catch(() => false);

let devkitDir: string;

beforeAll(async () => {
  devkitDir = await exportDevkit();
}, 60_000);

afterAll(async () => {
  await cleanupTemp();
});

describe("widget:devkit", () => {
  test("exports a self-contained tsconfig.json + types/", async () => {
    expect(await exists(join(devkitDir, "tsconfig.json"))).toBe(true);
    expect(await exists(join(devkitDir, "types"))).toBe(true);
  });
});

describe("a well-formed widget in an external root", () => {
  test("typechecks, builds, checks, and installs cleanly", async () => {
    const root = await makeScenarioRoot(devkitDir, ["good-widget"]);
    const widgetDir = join(root, "good-widget");
    const appData = await makeTempDir("wigl-e2e-appdata-");

    const tc = await typecheck(root);
    expect(tc.code, tc.stdout + tc.stderr).toBe(0);

    const build = await runWidgetCli(["build", widgetDir]);
    expect(build.code).toBe(0);
    expect(await exists(join(widgetDir, ".wigl", "index.js"))).toBe(true);

    const check = await runWidgetCli(["check", widgetDir]);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("loads and renders");

    const install = await runWidgetCli(["install", widgetDir], { env: { WIGL_APP_DATA_DIR: appData } });
    expect(install.code).toBe(0);
    const installed = await readInstalled(appData, "good-widget", join(".wigl", "index.js"));
    expect(installed.length).toBeGreaterThan(0);

    const list = await runWidgetCli(["list"], { env: { WIGL_APP_DATA_DIR: appData } });
    expect(list.stdout).toContain("good-widget");

    const rm = await runWidgetCli(["rm", "good-widget"], { env: { WIGL_APP_DATA_DIR: appData } });
    expect(rm.code).toBe(0);
    expect(await exists(join(appData, "plugins", "good-widget"))).toBe(false);
  }, 30_000);
});

describe("widget:add", () => {
  test("clones a git URL, builds, and installs under the requested id", async () => {
    const repo = await makeGitFixtureRepo("good-widget");
    const appData = await makeTempDir("wigl-e2e-appdata-add-");

    const add = await runWidgetCli(["add", repo, "cloned-widget"], { env: { WIGL_APP_DATA_DIR: appData } });
    expect(add.code, add.stdout + add.stderr).toBe(0);
    const installed = await readInstalled(appData, "cloned-widget", join(".wigl", "index.js"));
    expect(installed.length).toBeGreaterThan(0);
  }, 30_000);

  test("derives the id from the URL when none is given", async () => {
    const repo = await makeGitFixtureRepo("good-widget");
    const appData = await makeTempDir("wigl-e2e-appdata-add-noid-");
    const idFromUrl = repo.split("/").pop() as string;

    const add = await runWidgetCli(["add", repo], { env: { WIGL_APP_DATA_DIR: appData } });
    expect(add.code, add.stdout + add.stderr).toBe(0);
    expect(await exists(join(appData, "plugins", idFromUrl))).toBe(true);
  }, 30_000);

  test("fails loudly on a bad URL instead of installing nothing silently", async () => {
    const appData = await makeTempDir("wigl-e2e-appdata-add-bad-");
    const add = await runWidgetCli(["add", join(appData, "nonexistent-repo")], {
      env: { WIGL_APP_DATA_DIR: appData },
    });
    expect(add.code).not.toBe(0);
    expect(add.stdout + add.stderr).toMatch(/git clone failed/);
  }, 30_000);
});

describe("a widget with a type error in an external root", () => {
  test("fails typecheck but still builds (build never typechecks)", async () => {
    const root = await makeScenarioRoot(devkitDir, ["broken-typecheck-widget"]);
    const widgetDir = join(root, "broken-typecheck-widget");

    const tc = await typecheck(root);
    expect(tc.code).not.toBe(0);
    expect(tc.stdout + tc.stderr).toMatch(/broken-typecheck-widget/);

    const build = await runWidgetCli(["build", widgetDir]);
    expect(build.code).toBe(0);
  }, 30_000);
});

describe("a widget with an unresolvable import in an external root", () => {
  test("fails widget:build loudly", async () => {
    const root = await makeScenarioRoot(devkitDir, ["broken-build-widget"]);
    const widgetDir = join(root, "broken-build-widget");

    const build = await runWidgetCli(["build", widgetDir]);
    expect(build.code).not.toBe(0);
    expect(build.stdout + build.stderr).toMatch(/wigl-e2e-nonexistent-package|build failed/);
  }, 30_000);
});

describe("a widget that never renders <Widget> in an external root", () => {
  test("builds fine but fails widget:check", async () => {
    const root = await makeScenarioRoot(devkitDir, ["no-widget-export"]);
    const widgetDir = join(root, "no-widget-export");

    const build = await runWidgetCli(["build", widgetDir]);
    expect(build.code).toBe(0);

    const check = await runWidgetCli(["check", widgetDir]);
    expect(check.code).not.toBe(0);
    expect(check.stdout + check.stderr).toMatch(/doesn't render <Widget>/);
  }, 30_000);
});

describe("WIGL_WIDGETS_ROOT sweep against an external root", () => {
  test("installs every qualifying widget, skips underscore-prefixed ones, prunes stale installs", async () => {
    const root = await makeScenarioRoot(devkitDir, ["good-widget"]);
    // Reuses the good-widget fixture under a leading-"_" name to prove the
    // no-arg sweep's opt-out convention (see widget.ts's allWidgetDirs)
    // still applies outside wigl-widgets/, not just inside it.
    const skippedRoot = await makeScenarioRoot(devkitDir, ["good-widget"]);
    await Bun.write(
      join(root, "_skip-me", "index.tsx"),
      await Bun.file(join(skippedRoot, "good-widget", "index.tsx")).text(),
    );
    const appData = await makeTempDir("wigl-e2e-appdata-sweep-");

    const install = await runWidgetCli(["install"], {
      env: { WIGL_WIDGETS_ROOT: root, WIGL_APP_DATA_DIR: appData },
    });
    expect(install.code).toBe(0);
    expect(await exists(join(appData, "plugins", "good-widget"))).toBe(true);
    expect(await exists(join(appData, "plugins", "_skip-me"))).toBe(false);
  }, 30_000);
});

describe("invoked from an unrelated working directory", () => {
  // Moving the widgets is only half the relocation story — the CLI itself
  // has to not assume it's being launched with cwd == repo root either. A
  // real global invocation (a shell alias, a script run after `cd ~`) won't
  // have that guarantee the way `bun run widget:*` does. This caught a real
  // bug: scripts/widget.ts used bare relative strings ("wigl-widgets",
  // "src-tauri/tauri.conf.json", ...) that only worked by accident when cwd
  // happened to be the repo root — fixed by resolving them against the
  // script's own location (import.meta.dir) instead. Every test in this
  // block uses runWidgetCliFrom with cwd pointed at a directory that has
  // nothing to do with this repo, proving that fix holds.
  test("widget:devkit works with cwd elsewhere", async () => {
    const elsewhere = await makeTempDir("wigl-e2e-elsewhere-");
    const dest = await makeTempDir("wigl-e2e-foreign-devkit-");
    const result = await runWidgetCliFrom(elsewhere, ["devkit", dest]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(await exists(join(dest, "tsconfig.json"))).toBe(true);
    expect(await exists(join(dest, "types"))).toBe(true);
  }, 30_000);

  test("build/check/install of an absolute-path widget work with cwd elsewhere", async () => {
    const elsewhere = await makeTempDir("wigl-e2e-elsewhere-");
    const root = await makeScenarioRoot(devkitDir, ["good-widget"]);
    const widgetDir = join(root, "good-widget");
    const appData = await makeTempDir("wigl-e2e-appdata-foreign-");

    const build = await runWidgetCliFrom(elsewhere, ["build", widgetDir]);
    expect(build.code, build.stdout + build.stderr).toBe(0);

    const check = await runWidgetCliFrom(elsewhere, ["check", widgetDir]);
    expect(check.code, check.stdout + check.stderr).toBe(0);

    const install = await runWidgetCliFrom(elsewhere, ["install", widgetDir], {
      env: { WIGL_APP_DATA_DIR: appData },
    });
    expect(install.code, install.stdout + install.stderr).toBe(0);
    expect(await exists(join(appData, "plugins", "good-widget"))).toBe(true);
  }, 30_000);

  test("the no-arg WIGL_WIDGETS_ROOT sweep works with cwd elsewhere", async () => {
    const elsewhere = await makeTempDir("wigl-e2e-elsewhere-");
    const root = await makeScenarioRoot(devkitDir, ["good-widget"]);
    const appData = await makeTempDir("wigl-e2e-appdata-foreign-sweep-");

    const install = await runWidgetCliFrom(elsewhere, ["install"], {
      env: { WIGL_WIDGETS_ROOT: root, WIGL_APP_DATA_DIR: appData },
    });
    expect(install.code, install.stdout + install.stderr).toBe(0);
    expect(await exists(join(appData, "plugins", "good-widget"))).toBe(true);
  }, 30_000);
});

describe("error handling for bad paths", () => {
  test("WIGL_WIDGETS_ROOT pointing nowhere dies with a clear message", async () => {
    const result = await runWidgetCli(["install"], {
      env: { WIGL_WIDGETS_ROOT: "/definitely/not/a/real/path/on/this/machine" },
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/does not exist/);
  });

  test("an empty widgets root is a no-op, not a crash, but says so", async () => {
    const empty = await makeTempDir("wigl-e2e-empty-");
    const result = await runWidgetCli(["install"], { env: { WIGL_WIDGETS_ROOT: empty } });
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/no widget folders found/);
  });

  test("a single nonexistent widget dir dies with a clear message", async () => {
    const result = await runWidgetCli(["build", "/definitely/not/a/real/widget/dir"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/does not exist/);
  });
});
