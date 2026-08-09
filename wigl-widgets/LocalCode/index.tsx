import { useEffect, useMemo, useState } from "react";
import { PanelLeft } from "lucide-react";
import { Widget } from "@/wigl";
import { useStorage } from "@/wigl/hooks";
import { cn, homeDir } from "@/wigl/utils";
import { Sidebar } from "./components/Sidebar";
import { SessionPanel } from "./components/SessionPanel";
import { DEFAULT_HOUSEKEEPER_MODEL, STORAGE_KEYS } from "./config";
import { useModelCatalog } from "./useModelCatalog";
import { useOpencodeServer } from "./useOpencodeServer";
import { useSessions } from "./useSessions";
import type { ModelSelection } from "./types";

const LocalCodeWidget = () => {
  const [activeID, setActiveID] = useState<string | null>(null);
  const [defaultDir, setDefaultDir] = useStorage<string>(
    "localcode_default_dir",
    "",
  );
  const [sidebarOpen, setSidebarOpen] = useStorage<boolean>(
    STORAGE_KEYS.sidebarOpen,
    true,
  );
  // `status`/`restart` stay unused until the shared error-overlay component
  // exists (TODO.md) — `baseUrl` being null is what the header dot shows.
  const { baseUrl } = useOpencodeServer(defaultDir || null);
  const { sessions, createSession, renameSession, togglePin, deleteSession } =
    useSessions(baseUrl, defaultDir || null);
  const catalog = useModelCatalog(baseUrl);
  const [housekeeperModel] = useStorage<ModelSelection>(
    STORAGE_KEYS.housekeeperModel,
    DEFAULT_HOUSEKEEPER_MODEL,
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeID) ?? null,
    [sessions, activeID],
  );
  const housekeeper = useMemo(
    () =>
      baseUrl && activeSession
        ? {
            model: housekeeperModel,
            directory: activeSession.directory,
            onTitle: renameSession,
          }
        : undefined,
    [baseUrl, activeSession, housekeeperModel, renameSession],
  );

  // Seeds the default directory from $HOME exactly once — deliberately
  // `[]`, not `[defaultDir]`: a value already present (including one the
  // user typed themselves) must never be overwritten from here.
  useEffect(() => {
    if (!defaultDir) homeDir().then(setDefaultDir).catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!defaultDir) return;
    const session = await createSession(defaultDir);
    setActiveID(session.id);
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    setActiveID((prev) => (prev === id ? null : prev));
  };

  return (
    <Widget
      w={10}
      h={9}
      col={0}
      row={0}
      headerContent={
        <>
          <button
            type="button"
            data-no-drag
            title={sidebarOpen ? "hide sessions" : "show sessions"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <PanelLeft
              className={cn(
                "size-3.5 transition-transform duration-300",
                !sidebarOpen && "-scale-x-100",
              )}
            />
          </button>
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/70">
            {activeSession?.displayTitle ?? "localcode"}
          </span>
          {/* The only always-on status: is the agent server reachable. Anything
            richer belongs in the shared error surface, not a status bar. */}
          <span
            title={baseUrl ? "opencode ready" : "starting opencode…"}
            className={cn(
              "size-1.5 shrink-0 rounded-full transition-colors duration-500",
              baseUrl
                ? "bg-primary/70"
                : "animate-pulse bg-muted-foreground/40",
            )}
          />
        </>
      }
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          sessions={sessions}
          activeID={activeID}
          open={sidebarOpen}
          onSelect={setActiveID}
          onCreate={handleCreate}
          onRename={renameSession}
          onTogglePin={togglePin}
          onDelete={handleDelete}
        />
        <SessionPanel
          baseUrl={baseUrl}
          sessionID={activeID}
          catalog={catalog}
          housekeeper={housekeeper}
          onCreate={handleCreate}
        />
      </div>
    </Widget>
  );
};

export default LocalCodeWidget;
