import { useEffect, useState } from "react";
import { PanelLeft, RotateCw } from "lucide-react";
import { ErrorOverlay, Widget } from "@/wigl";
import { useStorage } from "@/wigl/hooks";
import { cn, homeDir } from "@/wigl/utils";
import { Sidebar } from "./components/Sidebar";
import { SessionPanel } from "./components/SessionPanel";
import { STORAGE_KEYS } from "./config";
import { useModelCatalog } from "./useModelCatalog";
import { useOpencodeServer } from "./useOpencodeServer";
import { useSessions } from "./useSessions";

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
  const { status, baseUrl, ollamaOnline, ollamaStarting, restart, reloadModels, startOllamaNow } = useOpencodeServer(
    defaultDir || null,
  );
  const { sessions, loading, createSession, renameSession, togglePin, deleteSession } =
    useSessions(baseUrl, defaultDir || null);
  const catalog = useModelCatalog(baseUrl);

  const activeSession = sessions.find((s) => s.id === activeID) ?? null;

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
          {/* Ollama isn't polled (see useOpencodeServer.ts) — checked once
            per connect, and again here on click, which doubles as "I just
            ran `ollama pull`, pick it up now" without a full app restart.
            When unreachable, the same click spawns `ollama serve` instead
            (F4 in backlog.md) rather than just re-checking. */}
          <button
            type="button"
            data-no-drag
            onClick={ollamaOnline === false ? startOllamaNow : reloadModels}
            disabled={ollamaStarting}
            title={
              ollamaStarting
                ? "starting ollama…"
                : ollamaOnline === false
                  ? "ollama unreachable — click to start it"
                  : "reload ollama models (pick up a fresh `ollama pull`)"
            }
            className={cn(
              "rounded-md p-0.5 transition-colors duration-150 hover:bg-muted disabled:opacity-50",
              ollamaOnline === false ? "text-destructive" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <RotateCw className={cn("size-3", ollamaStarting && "animate-spin")} />
          </button>
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
        {status === "offline" ? (
          <ErrorOverlay
            kind="known"
            title="opencode server isn't running"
            message="It failed to start — check that opencode is installed and reachable, then retry."
            onRetry={restart}
          />
        ) : (
          <>
            <Sidebar
              sessions={sessions}
              activeID={activeID}
              open={sidebarOpen}
              loading={loading}
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
              recentSessions={sessions}
              sessionsLoading={loading}
              onSelect={setActiveID}
              onCreate={handleCreate}
            />
          </>
        )}
      </div>
    </Widget>
  );
};

export default LocalCodeWidget;
