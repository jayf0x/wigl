#!/usr/bin/env bun
/**
 * PostToolUse hook — after an agent edits a widget's source, rebuild that one
 * widget and render it headlessly (`widget verify`). Silent when it passes.
 *
 * Wired up in `.claude/settings.json`. Not a command anyone runs by hand
 * (that's `bun run widget:verify <dir>`), which is why it has no root
 * package.json entry.
 *
 * Why a hook rather than a line in AGENTS.md telling agents to verify: the
 * instruction already exists there and is still the single most-repeated
 * failure in this repo's history — "you did not QA the actual widget", "no
 * widgets render", "did you already do a new build?". An instruction relies
 * on the agent remembering; this doesn't.
 *
 * Why it costs nothing when nothing is wrong: a passing run writes no output
 * and exits 0, so the agent's context never sees it. Only a failure is worth
 * tokens, and a failure is exactly when a few hundred tokens are cheaper than
 * the round-trip of the owner finding it in `qa:app` instead. The whole
 * `widget verify` sweep across every widget takes ~0.4s; one widget is less.
 *
 * Exit codes are the hook contract, not this script's own invention: 0 =
 * nothing to say, 2 = stderr goes back to the agent as feedback.
 */
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

interface HookInput {
  tool_name?: string;
  tool_input?: { file_path?: string };
}

const raw = await Bun.stdin.text();
let input: HookInput;
try {
  input = JSON.parse(raw) as HookInput;
} catch {
  process.exit(0); // Not our business to police the harness's payload shape.
}

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

// `wigl-widgets/<name>/...` → `<name>`, and nothing else. Deliberately narrow:
// - `.wigl/` is build output, so an edit there is either this script's own
//   doing or hand-poking a bundle; neither warrants a rebuild.
// - `types/` is generated host types, `_`-prefixed folders are opted out of
//   discovery entirely (see scripts/widget.ts), and a file sitting directly
//   at the widgets root belongs to no widget.
const match = /(?:^|\/)wigl-widgets\/([^/_][^/]*)\/(?!\.wigl\/)/.exec(filePath);
if (!match) process.exit(0);
const name = match[1];
if (name === "types" || name === "node_modules") process.exit(0);

const proc = Bun.spawn(["bun", "scripts/widget.ts", "verify", `wigl-widgets/${name}`], {
  cwd: repoRoot,
  // The build refuses to run under any other NODE_ENV, and for a real reason
  // — see requireProductionEnv in scripts/widget.ts.
  env: { ...process.env, NODE_ENV: "production" },
  stdout: "pipe",
  stderr: "pipe",
});
const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

if (code === 0) process.exit(0); // The whole point: passing is silent.

console.error(
  [
    `wigl: widget "${name}" does not build+render after that edit.`,
    (out + err).trim(),
    `Reproduce with: bun run widget:verify wigl-widgets/${name}`,
  ]
    .filter(Boolean)
    .join("\n"),
);
process.exit(2);
