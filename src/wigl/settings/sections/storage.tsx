import { appDataDir, join } from "@tauri-apps/api/path";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sql } from "../../storage/client";
import { revealPath } from "../../utils";
import { getConfigOverrides, setConfigOverride } from "../config";
import type { SettingSection } from "../types";

interface Paths {
  defaultRoot: string;
  plugins: string;
  config: string;
}

// plugins/config always shown relative to whatever root is *currently
// pending* (an override already saved this session, else the OS default) —
// wigl-config.json itself is the one exception, always at defaultRoot, since
// it's what a relocated app would have to find *before* it knows to look
// anywhere else (see settings/config.ts's storageRoot).
const loadPaths = async (rootOverride: string): Promise<Paths> => {
  const defaultRoot = await appDataDir();
  return {
    defaultRoot,
    plugins: await join(rootOverride || defaultRoot, "plugins"),
    config: await join(defaultRoot, "wigl-config.json"),
  };
};

const PathRow = ({ label, path }: { label: string; path: string }) => (
  <div className="flex items-center justify-between gap-2 px-1">
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</span>
      <span className="truncate font-mono text-[11px] text-foreground/80" title={path}>
        {path}
      </span>
    </div>
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => revealPath(path).catch(console.error)}
      title={`Reveal ${label.toLowerCase()}`}
      aria-label={`Reveal ${label.toLowerCase()}`}
      className="shrink-0"
    >
      <FolderOpen className="size-3.5" />
    </Button>
  </div>
);

const StorageSection = () => {
  // Tier 2 (restart-required, see settings/config.ts) — same pattern as
  // grid.tsx: local pending state seeded once, one write per change/blur,
  // the field always shows the *pending* value, not what's live on screen.
  const [overrides, setOverrides] = useState(() => getConfigOverrides("storage"));
  const rootOverride = typeof overrides.root === "string" ? overrides.root : "";

  const [paths, setPaths] = useState<Paths | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    loadPaths(rootOverride).then(setPaths).catch(console.error);
  }, [rootOverride]);

  const commitRoot = (value: string) => {
    const next = { ...overrides };
    if (value) next.root = value;
    else delete next.root;
    setOverrides(next);
    setConfigOverride("storage", next).catch((e) => console.error("[wigl] storage settings write failed", e));
  };

  const clearCache = async () => {
    setClearing(true);
    setCleared(false);
    try {
      // useQuery's sql-backed cache (see hooks/useQuery.ts) is every kv row
      // whose key starts with "query_" — a widget's own useStorage keys never
      // start with that, so this can't touch anything but cached query
      // results, no matter which widget wrote them.
      await sql("DELETE FROM kv WHERE key LIKE 'query\\_%' ESCAPE '\\'");
      setCleared(true);
    } catch (e) {
      console.error("[wigl] clear cache failed", e);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
          Data folder
        </div>
        <div className="flex items-center gap-2 px-1">
          <Input
            type="text"
            placeholder={paths?.defaultRoot ?? "default"}
            value={rootOverride}
            onChange={(e) => commitRoot(e.target.value)}
            className="h-7 flex-1 font-mono text-[11px]"
          />
          <Button variant="outline" size="sm" onClick={() => commitRoot("")} disabled={!rootOverride}>
            Reset to default
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          Where the database and installed widgets live — <code>wigl-config.json</code> itself always stays at the
          default location so it can be found on the next launch. A path here must already exist and be writable;
          takes effect on restart.
        </p>
      </div>

      <div className="border-border/60 border-t pt-3">
        <div className="mb-2 px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
          Paths
        </div>
        {paths ? (
          <div className="flex flex-col gap-2.5">
            <PathRow label="Installed widgets" path={paths.plugins} />
            <PathRow label="Settings file" path={paths.config} />
          </div>
        ) : (
          <div className="px-1 text-muted-foreground text-xs">Loading…</div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-border/60 border-t pt-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={clearCache} disabled={clearing} className="w-fit">
            {clearing ? "Clearing…" : "Clear cached data"}
          </Button>
          {cleared && <span className="text-[11px] text-muted-foreground">Cleared.</span>}
        </div>
        <p className="px-1 text-[11px] text-muted-foreground">
          Clears cached results from <code>useQuery</code> (e.g. GitHub/repo data) — a widget's own saved data isn't
          touched, it just refetches on next use.
        </p>
      </div>
    </div>
  );
};

export const storageSection: SettingSection = {
  id: "storage",
  label: "Storage",
  fields: [
    { id: "storage-root", label: "Data folder", keywords: ["folder", "move", "relocate", "path"] },
    { id: "storage-paths", label: "Data paths", keywords: ["folder", "database", "path", "settings file"] },
    { id: "storage-clear-cache", label: "Clear cached data", keywords: ["cache", "reset"] },
  ],
  render: () => <StorageSection />,
};
