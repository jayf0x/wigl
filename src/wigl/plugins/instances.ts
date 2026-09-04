// F6 / F14 — multiple instances of one widget folder ("duplicate widget").
// This file owns the id math that's neither "folder identity" (types.ts's
// resolvePluginConfig — disk path, code, permissions) nor "runtime scoping"
// (loader.ts/registry.ts — per-instance require/storage binding): given a
// folder and its current extra-instance ids, mint a fresh distinct one.
//
// F14: the set of extra instances is session-temporary — held in App.tsx
// React state, seeded empty each launch, broadcast monitor-to-monitor over
// the `wigl-duplicates` Tauri event, and never persisted. There is no kv
// row for it any more.

/** folder id -> the extra instance ids beyond the always-present base
 * instance. The base instance's id is always the folder id itself (see
 * types.ts's WidgetManifest) and is never listed here — only duplicates. */
export type WidgetInstances = Record<string, string[]>;

/** A fresh instance id for `folder`, guaranteed distinct from the base
 * instance (the folder id itself) and from every id already recorded for
 * it — collision-checked with a retry loop rather than assumed unique from
 * randomness alone, since a caller could hand in a stale `existing` list.
 *
 * Restricted to the same charset useStorage's own KEY_RE allows for a key
 * segment (`[a-zA-Z0-9_-]`, i.e. its full charset minus `:`, which the
 * registry's `<instanceId>:` prefix already reserves as the separator) —
 * this id becomes part of every useStorage/useQuery key the instance ever
 * writes, so it has to be as key-safe as a plugin id always has been. */
export const generateInstanceId = (folder: string, existing: string[]): string => {
  const taken = new Set([folder, ...existing]);
  let id: string;
  do {
    id = `${folder}-${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(id));
  return id;
};
