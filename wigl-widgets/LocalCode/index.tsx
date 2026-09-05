import { useEffect, useState } from "react";
import { PanelLeft, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorOverlay, Widget } from "@/wigl";
import { useStorage } from "@/wigl/hooks";
import { cn, homeDir } from "@/wigl/utils";
import { Sidebar } from "./components/Sidebar";
import { SessionPanel } from "./components/SessionPanel";
import { STORAGE_KEYS } from "./config";
import { useModelCatalog } from "./hooks/useModelCatalog";
import { useOpencodeServer } from "./hooks/useOpencodeServer";
import { useSessions } from "./hooks/useSessions";

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
  const { sessions, loading, createSession, renameSession, autoRenameSession, togglePin, deleteSession } =
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
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-no-drag
            title={sidebarOpen ? "hide sessions" : "show sessions"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md text-muted-foreground"
          >
            <PanelLeft
              className={cn(
                "size-3.5 transition-transform duration-300",
                !sidebarOpen && "-scale-x-100",
              )}
            />
          </Button>
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/70">
            {activeSession?.displayTitle ?? "localcode"}
          </span>
          {/* Ollama isn't polled (see useOpencodeServer.ts) — checked once
            per connect, and again here on click, which doubles as "I just
            ran `ollama pull`, pick it up now" without a full app restart.
            When unreachable, the same click spawns `ollama serve` instead
            (F4 in backlog.md) rather than just re-checking. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
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
              "rounded-md",
              ollamaOnline === false
                ? "text-destructive hover:text-destructive"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <RotateCw className={cn("size-3", ollamaStarting && "animate-spin")} />
          </Button>
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
          >
            {ollamaOnline === false && (
              <Button
                type="button"
                variant="ghost"
                data-no-drag
                onClick={startOllamaNow}
                disabled={ollamaStarting}
                className="h-auto gap-1 border border-border px-2 py-1 text-[11px] font-normal text-foreground/80"
              >
                {ollamaStarting ? "starting ollama…" : "boot ollama"}
              </Button>
            )}
          </ErrorOverlay>
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
              onFirstMessage={autoRenameSession}
            />
          </>
        )}
      </div>
    </Widget>
  );
};

export default LocalCodeWidget;
