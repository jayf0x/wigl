import { join } from "@tauri-apps/api/path";
import { Download, FolderOpen, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useGlobalActions, useStorage } from "../../hooks";
import { pluginsDir } from "../../plugins";
import { RESERVED_PLUGIN_IDS, resolvePluginConfig } from "../../plugins/types";
import { revealPath, runCmd } from "../../utils";
import type { SettingSection } from "../types";

// This section talks to `pluginsDir()` (app_data_dir()/plugins) directly via
// `sh`, the same way src/wigl/plugins/loader.ts discovers/reads plugins at
// startup — it does NOT import scripts/widget.ts's `list`/`remove`/`add`.
// That script only runs under `bun` (node:fs/promises, Bun.build) and can't
// be bundled into a webview; the CLI's own command table (see that file) is
// for CLI introspection, not a runtime dependency of this UI.
//
// `installFromUrl` below reimplements `add`'s clone-and-copy half through
// `sh`/`git` (already allowed via shell:allow-execute/spawn's "sh" entry —
// see src-tauri/capabilities/default.json) rather than calling into the
// script. It can only ever install a widget that already ships a prebuilt
// entry (`.wigl/index.js` or a package.json `main`): a webview has no
// TypeScript bundler, so a widget whose repo has only `index.tsx` source
// still needs `bun run widget:add <git-url>` from a terminal.
const shq = (s: string) => `'${s.split("'").join(`'\\''`)}'`;

interface InstalledWidget {
  id: string;
  permissions: string[];
}

const listInstalled = async (): Promise<InstalledWidget[]> => {
  const dir = await pluginsDir();
  const ls = await runCmd("sh", ["-c", `ls -1 ${shq(dir)} 2>/dev/null || true`]);
  const ids = ls.stdout.split("\n").filter(Boolean);
  return Promise.all(
    ids.map(async (id) => {
      const pkg = await runCmd("sh", ["-c", `cat ${shq(await join(dir, id, "package.json"))} 2>/dev/null`]);
      const { permissions } = resolvePluginConfig(id, pkg.stdout || null);
      return { id, permissions };
    }),
  );
};

const removeInstalled = async (id: string) => {
  const dir = await pluginsDir();
  await runCmd("sh", ["-c", `rm -rf ${shq(await join(dir, id))}`]);
};

/** Mirrors scripts/widget.ts's `add`: clone into a throwaway temp dir named
 * after the target id, copy just the installed surface (package.json, the
 * resolved entry + its CSS/settings siblings) into pluginsDir(), then
 * discard the clone. Throws with a message pointing at the CLI when the
 * clone has no prebuilt entry to copy — see this file's header comment. */
const installFromUrl = async (url: string, idOverride: string) => {
  const id = idOverride.trim() || basenameNoGit(url);
  if (!id) throw new Error(`could not derive a widget id from "${url}" — enter one explicitly`);
  if (RESERVED_PLUGIN_IDS.has(id)) throw new Error(`"${id}" is a reserved id`);

  const tmp = (await runCmd("sh", ["-c", "mktemp -d"])).stdout.trim();
  if (!tmp) throw new Error("could not create a temp directory for the clone");
  const cloneDir = await join(tmp, id);
  try {
    const clone = await runCmd("sh", ["-c", `git clone --depth 1 ${shq(url)} ${shq(cloneDir)}`]);
    if (clone.code !== 0) throw new Error(clone.stderr.trim() || `git clone failed for "${url}"`);

    const pkgPath = await join(cloneDir, "package.json");
    const pkg = await runCmd("sh", ["-c", `cat ${shq(pkgPath)} 2>/dev/null`]);
    const { entry } = resolvePluginConfig(id, pkg.stdout || null);
    const entryPath = await join(cloneDir, entry);
    const entryExists = (await runCmd("sh", ["-c", `test -f ${shq(entryPath)} && echo yes`])).stdout.trim() === "yes";
    if (!entryExists) {
      throw new Error(
        `"${id}" has no prebuilt entry at "${entry}" — this repo ships TypeScript source, which a webview can't ` +
          `build. Run \`bun run widget:add ${url} ${id}\` from a terminal instead.`,
      );
    }

    const target = await join(await pluginsDir(), id);
    const targetEntry = await join(target, entry);
    const cssSrc = entryPath.replace(/\.js$/, ".css");
    const cssTarget = targetEntry.replace(/\.js$/, ".css");
    const settingsSrc = await join(cloneDir, entry.split("/").slice(0, -1).join("/"), "settingsSection.js");
    const settingsTarget = await join(target, entry.split("/").slice(0, -1).join("/"), "settingsSection.js");
    const copy = await runCmd("sh", [
      "-c",
      `set -e
rm -rf ${shq(target)}
mkdir -p "$(dirname ${shq(targetEntry)})"
[ -f ${shq(pkgPath)} ] && cp ${shq(pkgPath)} ${shq(await join(target, "package.json"))}
cp ${shq(entryPath)} ${shq(targetEntry)}
[ -f ${shq(cssSrc)} ] && cp ${shq(cssSrc)} ${shq(cssTarget)}
[ -f ${shq(settingsSrc)} ] && cp ${shq(settingsSrc)} ${shq(settingsTarget)}
true`,
    ]);
    if (copy.code !== 0) throw new Error(copy.stderr.trim() || `failed to install "${id}"`);
  } finally {
    await runCmd("sh", ["-c", `rm -rf ${shq(tmp)}`]);
  }
  return id;
};

const basenameNoGit = (url: string) => url.replace(/\/+$/, "").split("/").pop()?.replace(/\.git$/, "") ?? "";

// Same shared "widget_layout" kv record Desktop.tsx reads/writes — only the
// `closed` field is used here, so the type only claims that much. One
// storage key, no separate hide/show mechanism: this is the exact flag
// Desktop.tsx's own right-click "Show <id>" menu entries flip, just exposed
// here too so a widget doesn't have to be hidden by closing its own header
// first. Entries this section has never seen a saved position for (never
// placed on any monitor yet) don't get a toggle — flipping `closed` without
// a col/row/monitor would leave Desktop.tsx's layout-build effect nothing
// sane to place.
type SavedPositions = Record<string, { closed?: boolean; [k: string]: unknown }>;

const WidgetsSection = () => {
  const [widgets, setWidgets] = useState<InstalledWidget[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [saved, setSaved] = useStorage<SavedPositions>("widget_layout", {});
  const [addUrl, setAddUrl] = useState("");
  const [addId, setAddId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const globalActions = useGlobalActions();
  const reloadAction = globalActions.find((a) => a.id === "reload-widgets");

  useEffect(() => {
    listInstalled().then(setWidgets).catch(console.error);
  }, []);

  const onRemove = async (id: string) => {
    setRemoving(id);
    try {
      await removeInstalled(id);
      setWidgets(await listInstalled());
    } catch (e) {
      console.error(`[wigl] failed to remove widget "${id}"`, e);
    } finally {
      setRemoving(null);
    }
  };

  const toggleVisible = (id: string, hide: boolean) => {
    setSaved({ ...saved, [id]: { ...saved[id], closed: hide } });
  };

  const onAdd = async () => {
    if (!addUrl.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await installFromUrl(addUrl.trim(), addId);
      setWidgets(await listInstalled());
      setAddUrl("");
      setAddId("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-0.5">
        <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-widest">Installed</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => pluginsDir().then(revealPath).catch(console.error)}
            title="Open widgets folder"
            aria-label="Open widgets folder"
          >
            <FolderOpen className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => reloadAction?.run()}
            disabled={!reloadAction}
            title="Reload widgets"
            aria-label="Reload widgets"
          >
            <RotateCw className="size-3.5" />
          </Button>
        </div>
      </div>
      {widgets === null ? (
        <div className="px-1 text-muted-foreground text-xs">Loading…</div>
      ) : widgets.length === 0 ? (
        <div className="px-1 text-muted-foreground text-xs">
          No widgets installed. Use <code>bun run widget:install</code> from the repo to add one.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {widgets.map((w) => {
            const placed = saved[w.id] !== undefined;
            return (
              <div
                key={w.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm">{w.id}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {w.permissions.join(", ") || "no permissions"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={placed ? !saved[w.id]?.closed : true}
                    onCheckedChange={(checked) => toggleVisible(w.id, !checked)}
                    disabled={!placed}
                    title={placed ? "Show/hide on the desktop" : "Not placed on any desktop yet"}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemove(w.id)}
                    disabled={removing === w.id}
                    title={`Remove ${w.id}`}
                    aria-label={`Remove ${w.id}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="px-1 text-[11px] text-muted-foreground">
        Removing a widget only deletes the installed copy — reload widgets above to see the change without a
        restart.
      </p>

      <div className="flex flex-col gap-1.5 border-t pt-3">
        <span className="px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
          Install from a URL
        </span>
        <div className="flex items-center gap-1.5 px-0.5">
          <Input
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            placeholder="git URL"
            disabled={adding}
            className="h-7 flex-1 text-xs"
          />
          <Input
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            placeholder="id (optional)"
            disabled={adding}
            className="h-7 w-28 text-xs"
          />
          <Button variant="ghost" size="icon-sm" onClick={onAdd} disabled={adding || !addUrl.trim()} title="Install">
            <Download className="size-3.5" />
          </Button>
        </div>
        {addError && <p className="px-0.5 text-[11px] text-destructive">{addError}</p>}
        <p className="px-0.5 text-[11px] text-muted-foreground">
          Only works for a widget that already ships a prebuilt entry — one with only <code>index.tsx</code> source
          needs <code>bun run widget:add &lt;url&gt;</code> from a terminal instead.
        </p>
      </div>
    </div>
  );
};

export const widgetsSection: SettingSection = {
  id: "widgets",
  label: "Widgets",
  fields: [
    { id: "widgets-installed", label: "Installed widgets", keywords: ["remove", "uninstall", "plugin"] },
    { id: "widgets-visibility", label: "Show/hide widget", keywords: ["hide", "show", "visible"] },
    { id: "widgets-reload", label: "Reload widgets", keywords: ["refresh", "rescan"] },
  ],
  render: () => <WidgetsSection />,
};
