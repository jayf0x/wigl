#!/usr/bin/env bun
/**
 * Guard for the one code-shape rule in docs/principles.md that a machine can
 * actually decide: `const` arrow functions, never `function` declarations
 * (see "`export const`, not `export function`" there for the reasoning — this
 * script enforces that rule, it doesn't own it).
 *
 *   bun run check:style
 *
 * Why a script and not a biome rule: biome has no "no function declarations"
 * rule (`useArrowFunction` only rewrites function *expressions*), and biome's
 * `files.includes` covers `src/**` only, so widgets and scripts — where the
 * rule matters just as much — are unlinted either way.
 *
 * Why a script and not a paragraph anyone can read: it already was one, and
 * the drift got caught by the owner reviewing a diff by hand ("I still see
 * export function, instead of — like most — export const") rather than by any
 * tool. Prose can't fail a build.
 *
 * Deliberately regex-based, in the same spirit as check-eager.ts: this checks
 * one syntactic shape, doesn't need a parser to do it, and a false positive
 * costs a comment, not a bug.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const ROOTS = ["src", "scripts", "wigl-widgets"];

/** `src/components/ui` is vendored shadcn output — `bunx shadcn add` writes
 * `export function` and will keep doing so on every future component. Owned
 * code follows this repo's rules; generated code follows its generator's, and
 * fighting that would mean re-editing every component after every add.
 *
 * `wigl-widgets/types` is generated .d.ts (`bun run widget:types`), `.wigl` is
 * build output, `node_modules` is nobody's business. */
const SKIP_DIRS = new Set(["node_modules", ".wigl", "dist", "target", "types"]);
const SKIP_PATHS = ["src/components/ui"];

/** A `function` declaration at statement position — exported, top-level, or
 * nested inside another body. Not matched, on purpose:
 * - `function` as part of a larger expression (`const f = function () {}`) —
 *   biome's `useArrowFunction` already covers that shape inside `src/`.
 * - the word appearing in a string or comment, which is why the match must
 *   start at the beginning of a line modulo indentation. */
const RE_FN_DECL = /^[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+[A-Za-z_$]/gm;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".wigl") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const violations: string[] = [];
for (const root of ROOTS) {
  const abs = join(ROOT, root);
  try {
    if (!statSync(abs).isDirectory()) continue;
  } catch {
    continue;
  }
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file);
    if (SKIP_PATHS.some((p) => rel.startsWith(p))) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(RE_FN_DECL)) {
      const line = text.slice(0, m.index).split("\n").length;
      violations.push(`${rel}:${line}  ${m[0].trim()}...`);
    }
  }
}

if (!violations.length) {
  console.log("✓ no function declarations outside vendored code");
  process.exit(0);
}

console.error(`✗ ${violations.length} function declaration(s) — use a const arrow instead (docs/principles.md):\n`);
for (const v of violations) console.error(`  ${v}`);
console.error("\n  A React class component is the one legitimate exception, and it's a class, not a function.");
process.exit(1);
