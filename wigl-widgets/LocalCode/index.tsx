import { useEffect, useState } from "react";
import { Widget, WidgetHeader } from "@/wigl";
import { useStorage } from "@/wigl/hooks";
import { homeDir } from "@/wigl/utils";
import { Sidebar } from "./components/Sidebar";
import { SessionPanel } from "./components/SessionPanel";
import { ServerStatusBar } from "./components/ServerStatusBar";
import { useModelCatalog } from "./useModelCatalog";
import { useOllamaStatus } from "./ollama";
import { useOpencodeServer } from "./useOpencodeServer";
import { useSessions } from "./useSessions";

const LocalCodeWidget = () => {
  const { status: opencodeStatus, baseUrl, restart } = useOpencodeServer();
  const ollamaOnline = useOllamaStatus();
  const { sessions, createSession, renameSession, togglePin } = useSessions(baseUrl);
  const catalog = useModelCatalog(baseUrl);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [defaultDir, setDefaultDir] = useStorage<string>("localcode_default_dir", "");

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
        />
        <SessionPanel baseUrl={baseUrl} sessionID={activeID} catalog={catalog} />
      </div>
      <ServerStatusBar opencodeStatus={opencodeStatus} ollamaOnline={ollamaOnline} onRestartOpencode={restart} />
    </Widget>
  );
};

export default LocalCodeWidget;
