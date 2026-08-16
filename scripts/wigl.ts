#!/usr/bin/env bun
/**
 * wigl CLI — root dispatcher for repo-wide commands.
 *
 *   wigl test                 # every safe *.test.ts (widgets + tests/, incl. tests/e2e)
 *   wigl test widgets         # only wigl-widgets/<name>/tests/*.test.ts
 *   wigl test e2e             # only tests/e2e/*.test.ts (see tests/e2e/README.md)
 *
 * Uses bun's built-in test runner (bun:test) — no new dependency, same
 * reasoning as scripts/widget.ts using Bun.build instead of a bundler dep.
 * A widget's tests/ folder is plain convention, not a contract enforced by
 * widget:check — nothing requires a widget to have one.
 *
 * Deliberately never runs anything under tests/manual/ — those drive a real
 * OS cursor or need a live display, and are opt-in only (see
 * tests/manual/README.md and AGENTS.md's "Testing" section). They also
 * aren't `*.test.ts` files, so `bun test` wouldn't pick them up even by
 * accident.
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
      : scope === "e2e"
        ? ["tests/e2e"]
        : scope === undefined
          ? ["wigl-widgets", "tests"]
          : die(`unknown test scope "${scope}" — use "widgets" or "e2e"`);

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
    die("usage: wigl <command>\n  wigl test [widgets|e2e]");
    break;
  default:
    die(`unknown command "${command}"`);
}
