#!/usr/bin/env bun
/**
 * wigl CLI — root dispatcher for repo-wide commands.
 *
 *   wigl test                 # every *.test.ts in the repo (widgets + shared + e2e)
 *   wigl test widgets         # only wigl-widgets/<name>/tests/*.test.ts
 *   wigl test shared          # only src/wigl/**\/*.test.ts
 *   wigl test e2e             # only scripts/e2e/*.test.ts (see scripts/e2e/README.md)
 *
 * Uses bun's built-in test runner (bun:test) — no new dependency, same
 * reasoning as scripts/widget.ts using Bun.build instead of a bundler dep.
 * A widget's tests/ folder is plain convention, not a contract enforced by
 * widget:check — nothing requires a widget to have one.
 */
import { resolve } from "node:path";

const die = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const repoRoot = resolve(import.meta.dir, "..");

const runTest = async (scope: string | undefined) => {
  const dirs =
    scope === "widgets"
      ? ["wigl-widgets"]
      : scope === "shared"
        ? ["src/wigl"]
        : scope === "e2e"
          ? ["scripts/e2e"]
          : scope === undefined
            ? ["wigl-widgets", "src/wigl", "scripts/e2e"]
            : die(`unknown test scope "${scope}" — use "widgets", "shared", or "e2e"`);

  const proc = Bun.spawn(["bun", "test", ...dirs], {
    cwd: repoRoot,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  process.exit(code);
};

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "test":
    await runTest(rest[0]);
    break;
  case undefined:
    die("usage: wigl <command>\n  wigl test [widgets|shared]");
    break;
  default:
    die(`unknown command "${command}"`);
}
