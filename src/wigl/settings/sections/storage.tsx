import { appDataDir, join } from "@tauri-apps/api/path";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { sql } from "../../storage/client";
import { revealPath } from "../../utils";
import type { SettingSection } from "../types";

// Fixed by Tauri's app_data_dir() convention, not stored anywhere as a
// settable value — see backlog.md for the (bigger, deferred) idea of making
// the data folder itself relocatable via a Tier-2 override + folder picker.
interface Paths {
  root: string;
  plugins: string;
  config: string;
}

const loadPaths = async (): Promise<Paths> => {
  const root = await appDataDir();
  return {
    root,
    plugins: await join(root, "plugins"),
    config: await join(root, "wigl-config.json"),
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
  const [paths, setPaths] = useState<Paths | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    loadPaths().then(setPaths).catch(console.error);
  }, []);

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
          Paths
        </div>
        {paths ? (
          <div className="flex flex-col gap-2.5">
            <PathRow label="Storage" path={paths.root} />
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
    { id: "storage-paths", label: "Data paths", keywords: ["folder", "database", "path", "settings file"] },
    { id: "storage-clear-cache", label: "Clear cached data", keywords: ["cache", "reset"] },
  ],
  render: () => <StorageSection />,
};
