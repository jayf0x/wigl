---
name: wigl-ship
description: >
  The end-of-task ritual for wigl: build, install, relaunch, and hand the owner a
  freshly running app plus one specific thing to look at. Use after finishing any
  feature-sized change here (new or changed widget behavior, window/drag/theming
  work) — not after a one-line tweak. Also invoked directly via /wigl-ship. The
  owner does all visual QA; this skill's job is to make sure what they open is
  actually the build containing your change, and to tell them where to look.
---

# wigl-ship

This exists because the ritual was prose in `AGENTS.md` and prose gets half-done.
The failure it prevents is specific and has happened repeatedly: the owner opens
the app, sees the previous build, and reports "did you already do a new build?" or
"seems like not much has changed."

Run the steps in order. Don't skip one because it "can't have broken" — the whole
value is that it's mechanical.

## 1. Static checks

```bash
bun run typecheck
```

If the change touched `src/` or a widget, also `bun run build`. A failure here
stops the ritual — fix it, then restart at step 1.

## 2. Prove the widgets actually run

```bash
bun run widget:verify
```

Builds and headlessly renders every widget through the real host module registry,
with only each widget's declared permissions. ~0.4s for all of them. This catches
the class `typecheck` cannot: jsx-runtime mismatches, an undeclared permission or
host module, a first-render throw. `typecheck` passing means nothing about whether
a widget renders.

If you only touched one widget, `bun run widget:verify wigl-widgets/<name>` is the
same check scoped down. Note the repo-level `PostToolUse` hook already ran this for
any widget you edited — a clean run here is confirmation, not duplication.

## 3. Full app verify

```bash
bun run verify
```

Builds the debug app, kills any stale instance, relaunches, confirms it's up, and
greps the log for errors. Read its output — "wigl is running" plus `none` under log
errors is the pass condition. Anything under `--- log errors ---` is yours to
explain before handing off, even if the app is up.

Never substitute `bun run qa` here: that's the owner's own fast loop, and it skips
the window/log checks that make this step worth running.

## 4. Update the docs that just went stale

`AGENTS.md`'s table names one owner file per slice of ground truth. If this change
moved any of it — a rewritten subsystem, a removed dependency, a renamed contract —
update that file now, in this change. If it fixed something in `backlog.md`, delete
that entry (don't check it off).

Most small changes move none of it. Say so rather than inventing an edit.

## 5. Hand off with one specific thing to look at

The owner does the visual QA — never claim a change looks right, and never open a
browser or take a screenshot to check it yourself.

End with, in this order:

- what changed, in a sentence
- the exact gesture or screen to look at ("drag the calendar widget between
  monitors", not "please QA")
- anything you could not verify, named plainly

If `verify` failed and you couldn't fix it, say that instead — a broken build
handed over as if it were finished is the one outcome worse than an unfinished task.
