import { useEffect, useMemo, useState } from "react";
import { Widget, WidgetHeader } from "@/wigl";
import { useStorage } from "@/wigl/hooks";
import { homeDir } from "@/wigl/utils";
import { Sidebar } from "./components/Sidebar";
import { SessionPanel } from "./components/SessionPanel";
import { ServerStatusBar } from "./components/ServerStatusBar";
import { DEFAULT_HOUSEKEEPER_MODEL, STORAGE_KEYS } from "./config";
import { useModelCatalog } from "./useModelCatalog";
import { useOllamaStatus } from "./ollama";
import { useOpencodeServer } from "./useOpencodeServer";
import { useSessions } from "./useSessions";
import type { ModelSelection } from "./types";

const LocalCodeWidget = () => {
  const [activeID, setActiveID] = useState<string | null>(null);
  const [defaultDir, setDefaultDir] = useStorage<string>("localcode_default_dir", "");
  const { status: opencodeStatus, baseUrl, restart } = useOpencodeServer(defaultDir || null);
  const ollamaOnline = useOllamaStatus();
  const { sessions, createSession, renameSession, togglePin, deleteSession } = useSessions(baseUrl, defaultDir || null);
  const catalog = useModelCatalog(baseUrl);
  const [housekeeperModel] = useStorage<ModelSelection>(STORAGE_KEYS.housekeeperModel, DEFAULT_HOUSEKEEPER_MODEL);

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeID) ?? null, [sessions, activeID]);
  const housekeeper = useMemo(
    () =>
      baseUrl && activeSession
        ? { model: housekeeperModel, directory: activeSession.directory, onTitle: renameSession }
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
    <Widget w={7} h={8} col={0} row={0}>
      <WidgetHeader>
        <span className="px-1 text-[10px] tracking-widest opacity-40">LOCALCODE</span>
      </WidgetHeader>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          sessions={sessions}
          activeID={activeID}
          onSelect={setActiveID}
          onCreate={handleCreate}
          onRename={renameSession}
          onTogglePin={togglePin}
          onDelete={handleDelete}
        />
        <SessionPanel baseUrl={baseUrl} sessionID={activeID} catalog={catalog} housekeeper={housekeeper} />
      </div>
      <ServerStatusBar opencodeStatus={opencodeStatus} ollamaOnline={ollamaOnline} onRestartOpencode={restart} />
    </Widget>
  );
};

export default LocalCodeWidget;
