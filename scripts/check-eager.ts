// Static import-graph guard: fails if anything in the watchlist is reachable
// from an entry file via a *static* import. Dynamic `import()` (and
// `lazy(() => import())`, which compiles to the same thing) is invisible to
// this by construction — that's what makes an import "eager" vs. lazy.
// No deps beyond node:fs/node:path (bun runs this .ts directly, no build).
//
//   bun run check:eager                          # default: widgets must
//                                                 # never be statically
//                                                 # reachable from App.tsx
//   bun scripts/check-eager.ts <entry> <needle>...  # arbitrary check
//
// Regex-based, not a real parser — matches import/export ... from "x" and
// bare `import "x"`, skips `import type`/`export type`. Good enough for a
// guard script; not meant to replace tsc.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

const RE_FROM = /^(?:import|export)(?!\s+type\b)[^;\n]*?\bfrom\s+["']([^"']+)["']/gm;
const RE_BARE = /^import\s+["']([^"']+)["']/gm;

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate) && isFile(candidate)) return candidate;
  }
  return null;
}

function staticSpecifiers(text: string): string[] {
  const specs: string[] = [];
  for (const m of text.matchAll(RE_FROM)) specs.push(m[1]);
  for (const m of text.matchAll(RE_BARE)) specs.push(m[1]);
  return specs;
}

function traceEager(entry: string, watch: string[]) {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  const hits: { needle: string; spec: string; file: string }[] = [];
  while (queue.length) {
    const file = queue.shift() as string;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const spec of staticSpecifiers(text)) {
      const needle = watch.find((w) => spec.includes(w));
      if (needle) hits.push({ needle, spec, file });
      const local = resolveLocal(spec, file);
      if (local && !seen.has(local)) {
        seen.add(local);
        queue.push(local);
      }
    }
  }
  return { moduleCount: seen.size, hits };
}

const args = process.argv.slice(2);
const entry = args[0] ? resolve(ROOT, args[0]) : join(SRC, "App.tsx");
const watch = args.length > 1 ? args.slice(1) : ["/widgets/"];

const { moduleCount, hits } = traceEager(entry, watch);

if (hits.length) {
  console.error(`[check-eager] ${hits.length} static (eager) hit(s) reachable from ${entry.replace(ROOT + "/", "")}:`);
  for (const h of hits) {
    console.error(`  ${h.needle} <- ${h.spec} (${h.file.replace(ROOT + "/", "")})`);
  }
  console.error("Use React.lazy(() => import(...)) instead of a static import for these.");
  process.exit(1);
}

console.log(`[check-eager] clean — ${moduleCount} modules traced, no eager hits for [${watch.join(", ")}]`);
