# Handover

Working notes for whoever (agent or human) picks this up next. Read
`backlog.md` for the full task list (Features / Bugs / Improvements) — this
file is the few things to start with, plus context that doesn't belong in a
backlog entry.

## DONE: global "reset layout" action + on-load sanity pass

Both shipped together (right-click any widget → "Reset layout"). What
landed, for whoever touches this next:

- `src/wigl/actions.ts` — the global-action registry (`DESKTOP_ACTIONS`);
  adding the next action is one `{ id, label, run(ctx) }` entry.
- `settle()` in `src/wigl/grid.ts` — the reusable no-overlap pass, run on
  every bootstrap.
- `Desktop.tsx` bootstrap now validates stored positions (non-finite
  `col`/`row`/`m` → treated as unsaved, `m` beyond the monitor list → back
  to monitor 0) instead of trusting `widget_layout` blindly, so the NaN
  incident below can't repeat.
- Reset broadcasts `wigl-reset`; every monitor wipes `widget_layout` and
  rebootstraps, which lands everything on monitor 0 via `autoPlace` +
  `settle`.
- The click-through poller pauses while the menu is open (same
  `set_drag_active` trick as dragging) — menu can extend past hit-rects.

Not done: re-running `settle` after a cross-monitor drop adoption (the
drop handler's per-item `reflow` already resolves its collisions, so this
only matters if a bad state gets in some other way).

## Original incident context: on-load layout sanity pass

Triggered by a real incident: renaming `SavedPositions`'s fields (`x`/`y` →
`col`/`row`, done this session) left the on-disk `widget_layout` row with the
old field names. Nothing validated the shape on read, so `pos.col`/`pos.row`
off the legacy `{x, y}` object silently evaluated to `NaN`. That broke
everything downstream: `translate(NaN, NaN)` collapses every widget's
position to one corner, and `NaN` hit-rects sent to Rust never match the
cursor, so the whole window falls into permanent click-through — nothing
draggable, nothing clickable, the app looked "stuck". Patched by hand this
time (corrected the one user's local `widget_layout` row directly via
`sqlite3`) — what actually prevents a repeat is a general sanity pass on load.

What it should do, run once per monitor's `Desktop` right after `saved`
loads, **and** again after adopting a cross-monitor drop (`wigl-drop` in
`Desktop.tsx`) — the two places a bad position/monitor assignment can enter
`layout`:

1. **Validate each stored position is usable.** `col`/`row` (and `m`) must
   be finite numbers in a sane range. Anything else — missing, `NaN`, an old
   schema's field names — is treated as *no saved position*, falling back to
   `autoPlace`, never trusted blindly.
2. **Validate the target monitor exists.** If `m` points at a monitor index
   not in the current `availableMonitors()` list (unplugged display, or a
   value saved back when there were more screens), reassign it to monitor 0
   instead of orphaning the widget on a screen that will never render it.
3. **Guarantee zero overlap.** After every widget is placed — from a
   validated saved position or an auto-placed one — run them all through one
   settle pass so no two ever end up colliding, regardless of how they got
   into that state.

Where to hook it in: the bootstrap effect in `Desktop.tsx` (already the place
that turns `saved` into the initial `layout`) is the natural home for #1 and
#3; #2 needs `monitors.current` (already fetched via `availableMonitors()` in
the same file) compared against each item's `m`. Write this as one function
and call it from both the bootstrap effect and the `wigl-drop` listener,
rather than duplicating the checks — it was asked for as a shared checkup
specifically so both places (and any future one, e.g. the monitor-add/remove
reconciliation in `backlog.md`) stay covered by the same logic.

## Also: rebuild the anchor field in SVG, not Canvas

`Desktop.tsx` currently draws the drag-time "anchor field" (cross marks on
every grid cell corner, brightening near the cursor, locking onto the drop
target's four corners) on a `<canvas>` with `CanvasRenderingContext2D`,
redrawn every frame via `requestAnimationFrame`. This is being replaced with
an SVG-based version. The canvas version is still fully wired up and working
— nothing was removed — this is a planned rework, not a repair.

Why SVG: per-frame full-canvas redraws for a mostly-static grid of crosses is
more machinery than the effect needs; SVG lets individual cross elements be
targeted/animated with CSS instead of hand-rolled canvas math, and composes
better with the rest of the DOM (styling, dark mode, etc. already all CSS).

### Snapshot of the current canvas implementation (`src/wigl/Desktop.tsx`)

State/refs involved:
```ts
const canvas = useRef<HTMLCanvasElement>(null);
const cursor = useRef({ x: -1e4, y: -1e4 }); // page px
const ghostCell = useRef<GridItem | null>(null); // current drop-target cell, or null
const field = useRef({ alpha: 0, target: 0, raf: 0 }); // fade in/out state
```

Render loop:
```ts
const drawField = () => {
  const cv = canvas.current;
  const f = field.current;
  if (!cv) return;
  const ctx = cv.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== window.innerWidth * dpr) {
    cv.width = window.innerWidth * dpr;
    cv.height = window.innerHeight * dpr;
  }
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (f.alpha < 0.005 && f.target === 0) {
    f.raf = 0;
    return;
  }
  const p = TILING.cell + TILING.gap;
  const half = TILING.gap / 2;
  const R = TILING.field.influence;
  const g = ghostCell.current;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.lineCap = "round";
  for (let cx = 0, x = colToPx(0) - half; x < window.innerWidth - TILING.padding.right + p; cx++, x += p) {
    for (let cy = 0, y = rowToPx(0) - half; y < window.innerHeight - TILING.padding.bottom + p; cy++, y += p) {
      // Anchor reacts to cursor proximity...
      const d = Math.hypot(x - cursor.current.x, y - cursor.current.y);
      const near = d < R ? (1 - d / R) ** 2 : 0;
      // ...and locks in when it's a corner of the drop target.
      const corner = g && (cx === g.col || cx === g.col + g.w) && (cy === g.row || cy === g.row + g.h);
      const t = corner ? 1 : near;
      const arm = 3 + t * 2; // cross arm length: 6px cross swelling to 10px
      const a = f.alpha * (0.1 + t * 0.8);
      if (a < 0.01) continue;
      ctx.globalAlpha = Math.min(a, 1);
      ctx.strokeStyle = t > 0.05 ? `rgb(${ACCENT.r} ${ACCENT.g} ${ACCENT.b})` : "rgb(255 255 255)";
      ctx.lineWidth = 1 + t * 0.5;
      ctx.shadowBlur = t * 6;
      ctx.shadowColor = `rgb(${ACCENT.r} ${ACCENT.g} ${ACCENT.b} / 0.8)`;
      ctx.beginPath();
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
      ctx.stroke();
    }
  }
  ctx.restore();
  f.alpha += (f.target - f.alpha) * 0.12;
  f.raf = requestAnimationFrame(drawField);
};

const wakeField = (dragging: boolean) => {
  const { show } = TILING.field; // "drag" | "always" | "never"
  if (show === "never") return;
  field.current.target = dragging || show === "always" ? 1 : 0;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) field.current.alpha = field.current.target;
  if (!field.current.raf) field.current.raf = requestAnimationFrame(drawField);
};
```
`wakeField(true)`/`wakeField(false)` are called at every drag start/end/
cross-monitor handoff (grep `wakeField` in `Desktop.tsx` for the call sites).
`cursor.current` is updated on every pointer move; `ghostCell.current` holds
the current drop-target `GridItem` (or `null`) — both already exist and are
maintained regardless of which rendering approach draws them.

JSX + CSS:
```tsx
<canvas ref={canvas} className="wigl-field" />
```
```css
/* src/App.css */
.wigl-field {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
```

Config knobs (`src/wigl/tiling.config.ts`): `TILING.field.show` (`"drag" |
"always" | "never"`), `TILING.field.influence` (px radius of cursor
reaction). `ACCENT` (top of `Desktop.tsx`) must stay in sync with the
`--wigl-accent` CSS variable — keep that constraint whatever the new
implementation looks like.

### Shape of the SVG replacement (not prescriptive, just a starting point)

- One `<svg>` (or a grid of small SVG `<path>`/`<line>` elements) positioned
  the same way `.wigl-field` is now, sized to the viewport.
  - `<Widget>`/`<Component>` positioning already comes from `colToPx`/
    `rowToPx`/`spanToPx` (`src/wigl/grid.ts`) — reuse those for cross
    placement instead of re-deriving pixel math.
- Cursor-proximity brightening and drop-target corner lock-in are the two
  behaviors to preserve — whether that's per-cross CSS custom properties
  updated imperatively (cheapest, closest to today's model) or something
  reactive is an implementation choice.
- `prefers-reduced-motion` and the three `TILING.field.show` modes need to
  keep working.
- Once the SVG version is in and verified, delete the canvas code above
  (`drawField`, `wakeField`, the `canvas` ref/element, `field` ref) rather
  than keeping both paths around.
