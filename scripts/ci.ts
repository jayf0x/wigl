#!/usr/bin/env bun
/**
 * Trigger the `test` workflow (.github/workflows/test.yml) and follow it to
 * completion — the local half of the "iterate until Windows CI is green"
 * loop. Thin wrapper over `gh`; no new dependency.
 *
 *   bun run test:ci            # dispatch on the current branch, then watch
 *   bun run test:ci main       # dispatch on an explicit branch/ref
 *
 * Exits non-zero if any matrix leg fails, and dumps the failed-step logs so
 * a Windows-only break is visible without opening the browser.
 *
 * ponytail: `gh` already does dispatch, list, watch and log-dump — this
 * only stitches them and rides out the one race (a workflow_dispatch run
 * takes a second or two to appear in `gh run list`).
 */
const WORKFLOW = "test.yml";

const gh = async (args: string[]): Promise<string> => {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    console.error(err.trim() || `gh ${args.join(" ")} failed`);
    process.exit(1);
  }
  return out.trim();
};

const git = async (args: string[]): Promise<string> =>
  new Response(Bun.spawn(["git", ...args], { stdout: "pipe" }).stdout).text().then((s) => s.trim());

const branch = process.argv[2] ?? (await git(["rev-parse", "--abbrev-ref", "HEAD"]));

// Newest dispatch run id before we trigger — poll until it changes, rather
// than comparing timestamps (local vs GitHub clock skew ate the old check).
const latestDispatch = async (): Promise<string | undefined> => {
  const runs: { databaseId: number; event: string }[] = JSON.parse(
    await gh([
      "run", "list", "--workflow", WORKFLOW, "--branch", branch,
      "--limit", "5", "--json", "databaseId,event",
    ]),
  );
  const r = runs.find((r) => r.event === "workflow_dispatch");
  return r ? String(r.databaseId) : undefined;
};

console.log(`▶ dispatching ${WORKFLOW} on ${branch}`);
const before = await latestDispatch();
await gh(["workflow", "run", WORKFLOW, "--ref", branch]);

let runId = "";
for (let i = 0; i < 30 && !runId; i++) {
  await Bun.sleep(1500);
  const now = await latestDispatch();
  if (now && now !== before) runId = now;
}
if (!runId) {
  console.error("✗ dispatched run never appeared — check `gh run list` by hand");
  process.exit(1);
}

console.log(`▶ watching run ${runId} — ${await gh(["run", "view", runId, "--json", "url", "-q", ".url"])}`);
const code = await Bun.spawn(["gh", "run", "watch", runId, "--exit-status"], {
  stdio: ["inherit", "inherit", "inherit"],
}).exited;

if (code !== 0) {
  console.error("\n✗ CI failed — failed steps:\n");
  await Bun.spawn(["gh", "run", "view", runId, "--log-failed"], {
    stdio: ["inherit", "inherit", "inherit"],
  }).exited;
}
process.exit(code);
