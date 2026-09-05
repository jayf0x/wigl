import type { ComponentType, MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyGridOverrides, type GridOverrides, TILING } from "../grid/config";
import { autoPlace, colsForWidth, type GridItem, reflow, settle } from "../grid/math";
import { useStorage } from "../hooks";
import { generateInstanceId, type WidgetInstances } from "../plugins/instances";
import type { WidgetManifest } from "../plugins/types";
import type { WidgetGridReport, WidgetSlotValue } from "../widget";
import type { MonitorRect, SavedPositions } from "./types";

/** Owns the persisted per-widget layout (`widget_layout` storage key) and
 * every mutation of it: first-launch placement, a widget's own size report,
 * close/reopen, minimize, F14 duplicate/erase, and "Reset layout". This is
 * the single source of truth `layoutRef`/`savedRef` that drag, resize, and
 * cross-monitor sync all read and write through the setters returned here. */
export const useWidgetLayout = ({
  widgets,
  manifests,
  monitorIndex,
  duplicates,
  onDuplicatesChange,
  buildAnchors,
  monitorsRef,
}: {
  widgets: Record<string, ComponentType>;
  manifests: Record<string, WidgetManifest>;
  monitorIndex: number;
  duplicates: WidgetInstances;
  onDuplicatesChange?: (next: WidgetInstances) => void;
  buildAnchors: () => void;
  monitorsRef: MutableRefObject<MonitorRect[] | null>;
}) => {
  const [saved, setSaved, { loading }] = useStorage<SavedPositions>("widget_layout", {});
  // F11 half 1 — Settings-driven image+opacity background (src/wigl/settings/
  // sections/background.tsx writes both keys live, Tier 1, no restart). Only
  // read/rendered when no `background` plugin (Half 2) is installed — see
  // Desktop.tsx's render. ponytail: a data URL in the kv blob is the whole
  // image's bytes, base64-inflated, in one SQLite row — fine for a wallpaper-
  // sized image, a ceiling for anything large (multi-MB blob on every
  // useStorage poll/write). Upgrade path if that ever bites: write the bytes
  // to a file under storageRoot() and store just the path here instead.
  const [backgroundImage] = useStorage<string | null>("wigl_background_image", null);
  const [backgroundOpacity] = useStorage<number>("wigl_background_opacity", 1);
  // Settings > Grid writes this key; applied live onto TILING below (no
  // restart — grid math is JS-only, so there's nothing native to re-read).
  const [gridOverrides] = useStorage<GridOverrides>("wigl_grid", {});
  const [layout, setLayout] = useState<GridItem[] | null>(null);

  const layoutRef = useRef<GridItem[] | null>(null);
  const savedRef = useRef<SavedPositions>({});
  const instancesRef = useRef<WidgetInstances>({});
  // Ids with no saved position yet (true first launch, or a widget added
  // since the last save) — their real size/spot isn't known until they
  // report in, so reflow is deferred until every one of them has reported
  // at least once, then resolved in a single settle() pass. Otherwise the
  // settled layout would depend on mount/report arrival order instead of
  // being deterministic (see backlog).
  const pendingReports = useRef<Set<string>>(new Set());
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  useEffect(() => {
    instancesRef.current = duplicates;
  }, [duplicates]);

  // Places one widget id into `items` (mutating it via push) — factored out
  // so a widget id that appears *after* the initial layout already exists
  // (F6's "duplicate widget": a reload lands a new instance id in `widgets`
  // post-mount) can be placed the same way instead of silently never getting
  // a layout entry.
  const placeItem = (id: string, items: GridItem[], cols: number): void => {
    const s = saved[id];
    // Never trust storage blindly: a stale schema or unplugged monitor
    // must degrade to "no saved position", not NaN positions or an
    // orphaned widget (see docs/debugging.md's storage-shape-drift section).
    const validPos = s != null && Number.isFinite(s.col) && Number.isFinite(s.row);
    const mon = s != null && Number.isFinite(s.m) && s.m! < (monitorsRef.current?.length ?? Infinity) ? s.m! : 0;
    if (mon !== monitorIndex) return;
    const validSize = s != null && Number.isFinite(s.w) && Number.isFinite(s.h);
    const w = validSize ? s!.w! : TILING.defaultSize.w;
    const h = validSize ? s!.h! : TILING.defaultSize.h;
    const pos = validPos ? s : autoPlace(items, w, h, cols);
    items.push({
      id,
      w,
      h,
      col: Math.max(0, Math.min(pos.col, cols - w)),
      row: Math.max(0, pos.row),
      hidden: !!s?.closed,
    });
    if (!validPos) pendingReports.current.add(id);
  };

  // Build the layout once storage has answered: this monitor's widgets only
  // (unassigned widgets land on monitor 0). A widget's real size/first-launch
  // position isn't known until its own <Widget w h col row> mounts and
  // reports in (see reportGrid below) — until then it occupies
  // TILING.defaultSize. Positions come from storage first, else first fit.
  useEffect(() => {
    if (loading || layout) return;
    const cols = colsForWidth(window.innerWidth);
    const items: GridItem[] = [];
    pendingReports.current = new Set();
    for (const id of Object.keys(widgets)) placeItem(id, items, cols);
    // Saved/default positions can conflict after code changes — settle them.
    settle(items, cols);
    setLayout(items);
    // biome-ignore lint/correctness/useExhaustiveDependencies: placeItem closes over `saved` intentionally (see below)
  }, [loading, layout, saved, widgets, monitorIndex]);

  // Reconciles new widget ids that show up *after* the layout above already
  // built — a plain "Reload widgets" or F6's "Duplicate" both land a new id
  // in `widgets` without ever clearing `layout`, so the effect above (gated
  // on `!layout`) never runs again to pick it up. Appends only the missing
  // ids in place, without touching anyone else's position — unlike a full
  // rebuild (setLayout(null)), which would also needlessly re-settle every
  // already-placed widget.
  //
  // Deliberately not keyed on `saved` (only on `layout`/`widgets`/
  // `monitorIndex`) — `placeItem` still reads whatever `saved` this closure
  // captured. That's fine as long as an id never goes missing from `layout`
  // without `saved[id].m` already agreeing it's left — see endDrag's
  // cross-monitor branch, which flips `saved[d.id].m` in the same
  // synchronous handler as the `setLayout` that drops the id, specifically
  // so this effect's next run can't observe the two disagree and re-place a
  // widget that was just handed off to another monitor.
  //
  // `widgets` is every discovered plugin on disk, the same set on every
  // monitor window (see loadPlugins()/App.tsx) — not filtered to "this
  // monitor's own". So `missing` routinely contains ids that placeItem will
  // rightly no-op on forever (they're some *other* monitor's, per
  // `saved[id].m`) — that must not itself keep re-triggering this effect.
  // The functional updater below only returns a new array when it actually
  // placed something; returning the identical `prev` reference otherwise
  // lets React bail out of the re-render, so `layout` doesn't change
  // reference and this effect doesn't re-fire. Skipping that bail-out (an
  // unconditional `return items`, spreading `prev` regardless of whether
  // anything was pushed) reproduces a real infinite loop — confirmed live,
  // independent of any drag — any time this monitor's `widgets` includes so
  // much as one id that belongs to another monitor, which is the ordinary
  // multi-widget multi-monitor case, not an edge case.
  useEffect(() => {
    if (loading || !layout) return;
    const known = new Set(layout.map((i) => i.id));
    const missing = Object.keys(widgets).filter((id) => !known.has(id));
    if (missing.length === 0) return;
    const cols = colsForWidth(window.innerWidth);
    setLayout((prev) => {
      if (!prev) return prev;
      const items = [...prev];
      let placed = false;
      for (const id of missing) {
        if (items.some((i) => i.id === id)) continue;
        const before = items.length;
        placeItem(id, items, cols);
        if (items.length !== before) placed = true;
      }
      return placed ? items : prev;
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: placeItem closes over `saved` intentionally (see above)
  }, [loading, layout, widgets, monitorIndex]);

  // A widget's <Widget w h col row> reports its real size (and, the first
  // time it's ever seen with no saved position, its requested first-launch
  // spot) via a layout effect — this fires and settles before paint, so the
  // TILING.defaultSize placeholder above never actually flashes on screen.
  const reportGrid = (id: string, g: WidgetGridReport) => {
    setLayout((prev) => {
      if (!prev) return prev;
      const cur = prev.find((i) => i.id === id);
      if (!cur) return prev;
      const cols = colsForWidth(window.innerWidth);
      const savedPos = savedRef.current[id];
      const hasSavedPos = savedPos != null;
      // A resized size (savedPos.w/h) wins over the widget's own reported
      // size, same as a dragged col/row wins over its col/row hint — except
      // while minimized, which always forces 1x1 regardless of either.
      const hasSavedSize = savedPos?.w != null && savedPos?.h != null;
      const w = g.minimized ? 1 : hasSavedSize ? savedPos!.w! : g.w;
      const h = g.minimized ? 1 : hasSavedSize ? savedPos!.h! : g.h;
      const col = !hasSavedPos && g.col != null ? Math.max(0, Math.min(g.col, cols - w)) : cur.col;
      const row = !hasSavedPos && g.row != null ? Math.max(0, g.row) : cur.row;
      const hidden = !!g.hidden;
      const pending = pendingReports.current;
      if (cur.w === w && cur.h === h && cur.col === col && cur.row === row && !!cur.hidden === hidden) {
        pending.delete(id);
        return prev; // no-op, bail out
      }
      const next = prev.map((i) => (i.id === id ? { ...i, w, h, col, row, hidden } : { ...i }));
      if (pending.has(id)) {
        pending.delete(id);
        // Still waiting on other never-before-seen widgets to report their
        // real size — hold off reflowing so the result doesn't depend on
        // which one happened to report first.
        if (pending.size > 0) return next;
        settle(next, cols);
        return next;
      }
      reflow(next, next.find((i) => i.id === id)!, cols);
      return next;
    });
  };
  // Stable per-id callback identity (so <Widget>'s effect doesn't re-fire on
  // every Desktop render) that always calls the latest reportGrid closure.
  const reportGridRef = useRef(reportGrid);
  reportGridRef.current = reportGrid;

  // F14 — a duplicated instance's id differs from its folder id; the base
  // instance's always equals it. `manifests` may be `{}` (stale/test
  // caller) — then nothing counts as a duplicate.
  const isDuplicate = useCallback((id: string) => !!manifests[id] && manifests[id].folder !== id, [manifests]);

  // F14 — closing a duplicate *erases* it (not just hides it): drop it from
  // the session instance set (App.tsx broadcasts the change to every
  // monitor and reloads), and drop its `widget_layout` entry so nothing
  // lingers. Its `useStorage`/`useQuery` rows are left as inert orphans by
  // design — the hash id never recurs (F14's owner decision).
  const eraseDuplicate = useCallback(
    (id: string) => {
      const folder = manifests[id]?.folder;
      if (!folder) return;
      const rest = (instancesRef.current[folder] ?? []).filter((x) => x !== id);
      const next: WidgetInstances = { ...instancesRef.current };
      if (rest.length) next[folder] = rest;
      else delete next[folder];
      const { [id]: _drop, ...restSaved } = savedRef.current;
      setSaved(restSaved);
      setLayout((cur) => (cur ? cur.filter((it) => it.id !== id) : cur));
      onDuplicatesChange?.(next);
    },
    [manifests, setSaved, onDuplicatesChange],
  );

  // Close drives the same GridItem.hidden a widget's own report can set
  // (see widget.tsx's WidgetGridProps) — once hidden, <Component> isn't
  // rendered at all, so nothing but this setter (or reopening from the
  // menu) can ever bring it back. A duplicate (F14) is erased instead.
  const setClosed = useCallback(
    (id: string, closed: boolean) => {
      if (closed && isDuplicate(id)) {
        eraseDuplicate(id);
        return;
      }
      const prev = layoutRef.current;
      // B15 — showing a widget whose home monitor (saved[id].m) isn't us: our
      // own `layout` never contains this id at all (placeItem, both at build
      // and in the "missing ids" reconcile effect, skips any id that isn't
      // ours), so the plain hidden-flip below would silently no-op — nothing
      // to flip. Adopt it here instead, the same way a cross-monitor
      // drag-drop adopts: place it into our own layout and rewrite
      // saved[id].m to us in the same write, rather than waiting for the
      // actual owning monitor to notice the closed:false flip (which it
      // never does off a plain `saved` change).
      if (!closed && prev && !prev.some((it) => it.id === id)) {
        const s = savedRef.current[id];
        const validSize = s != null && Number.isFinite(s.w) && Number.isFinite(s.h);
        const w = validSize ? s!.w! : TILING.defaultSize.w;
        const h = validSize ? s!.h! : TILING.defaultSize.h;
        const cols = colsForWidth(window.innerWidth);
        const items = prev.map((it) => ({ ...it }));
        const pos = autoPlace(items, w, h, cols);
        const item: GridItem = { id, w, h, col: pos.col, row: pos.row, hidden: false };
        items.push(item);
        reflow(items, item, cols);
        setLayout(items);
        const nextSaved: SavedPositions = {
          ...savedRef.current,
          ...Object.fromEntries(
            items
              .filter((it) => !it.hidden)
              .map((it) => [it.id, { ...savedRef.current[it.id], col: it.col, row: it.row, m: monitorIndex }]),
          ),
          [id]: { ...savedRef.current[id], col: item.col, row: item.row, m: monitorIndex, closed: false },
        };
        setSaved(nextSaved);
        return;
      }
      const nextSaved: SavedPositions = {
        ...savedRef.current,
        [id]: { ...savedRef.current[id], closed },
      };
      if (prev) {
        const next = prev.map((it) => (it.id === id ? { ...it, hidden: closed } : { ...it }));
        const shown = !closed ? next.find((it) => it.id === id) : undefined;
        if (shown) {
          // Re-showing a widget onto a spot something else has taken over
          // since it was hidden: push the others out of the way (the same
          // reflow a drag runs) and persist where they land, so the fix
          // survives a restart instead of re-overlapping on next launch.
          reflow(next, shown, colsForWidth(window.innerWidth));
          for (const it of next) {
            if (it.hidden) continue;
            nextSaved[it.id] = {
              ...nextSaved[it.id],
              col: it.col,
              row: it.row,
              m: monitorIndex,
            };
          }
        }
        setLayout(next);
      }
      setSaved(nextSaved);
    },
    [setSaved, monitorIndex, isDuplicate, eraseDuplicate],
  );
  const toggleMinimize = useCallback(
    (id: string) => {
      const minimized = !savedRef.current[id]?.minimized;
      setSaved({
        ...savedRef.current,
        [id]: { ...savedRef.current[id], minimized },
      });
    },
    [setSaved],
  );

  // One WidgetSlotValue per id, recreated only when its minimized flag
  // actually flips — not on every Desktop render (a drag fires plenty of
  // those), so <Widget>'s effect deps stay stable in between.
  const slots = useRef<Map<string, { value: WidgetSlotValue; minimized: boolean }>>(new Map());
  const getSlot = (id: string, minimized: boolean): WidgetSlotValue => {
    const cached = slots.current.get(id);
    if (cached && cached.minimized === minimized) return cached.value;
    const value: WidgetSlotValue = {
      report: (report) => reportGridRef.current(id, report),
      minimized,
      onClose: () => setClosed(id, true),
      onToggleMinimize: () => toggleMinimize(id),
    };
    slots.current.set(id, { value, minimized });
    return value;
  };

  const persist = (items: GridItem[]) => {
    const merged = {
      ...savedRef.current,
      // Spread the existing record first: a plain {col,row,m} here would
      // wipe closed/minimized every time a widget is dragged.
      ...Object.fromEntries(
        items.map((it) => [
          it.id,
          {
            ...savedRef.current[it.id],
            col: it.col,
            row: it.row,
            m: monitorIndex,
          },
        ]),
      ),
    };
    // useStorage's own set() broadcasts this to every other window
    // (`wigl-kv`) — no bespoke layout-specific event needed.
    setSaved(merged);
  };

  // F14 — "Duplicate widget": mints a fresh instance id for `folder` and
  // hands it to App.tsx via `onDuplicatesChange`, which updates the session
  // instance state, broadcasts it to every monitor over `wigl-duplicates`,
  // and reloads so loadPlugins() picks the new instance up everywhere. The
  // duplicate lives only for this session — nothing is persisted.
  const duplicateWidget = useCallback(
    (folder: string) => {
      const newId = generateInstanceId(folder, instancesRef.current[folder] ?? []);
      const next: WidgetInstances = {
        ...instancesRef.current,
        [folder]: [...(instancesRef.current[folder] ?? []), newId],
      };
      onDuplicatesChange?.(next);
    },
    [onDuplicatesChange],
  );

  // Retune the grid live when Settings > Grid changes it (this window's edit
  // or another monitor's, via useStorage's cross-window broadcast): mutate
  // the shared TILING object, rebuild the anchor field, and drop `layout` so
  // the build effect re-runs from the new cell/gap/padding — same path
  // "Reset layout" already uses. The first run (mount, before storage has
  // answered) only applies the value onto TILING and lets the build effect
  // do the initial layout — no `setLayout(null)`, so a fresh launch with no
  // custom grid never pays for a redundant rebuild.
  const gridSettled = useRef(false);
  useEffect(() => {
    applyGridOverrides(gridOverrides);
    if (!gridSettled.current) {
      gridSettled.current = true;
      return;
    }
    buildAnchors();
    setLayout(null);
  }, [gridOverrides, buildAnchors]);

  return {
    loading,
    layout,
    setLayout,
    layoutRef,
    saved,
    setSaved,
    savedRef,
    instancesRef,
    backgroundImage,
    backgroundOpacity,
    isDuplicate,
    eraseDuplicate,
    setClosed,
    toggleMinimize,
    getSlot,
    persist,
    duplicateWidget,
  };
};
