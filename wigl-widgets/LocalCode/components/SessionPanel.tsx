import type { HousekeeperContext } from "../useActiveSession";
import { useActiveSession } from "../useActiveSession";
import type { useModelCatalog } from "../useModelCatalog";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { PermissionBar } from "./PermissionBar";

export const SessionPanel = ({
  baseUrl,
  sessionID,
  catalog,
  housekeeper,
}: {
  baseUrl: string | null;
  sessionID: string | null;
  catalog: ReturnType<typeof useModelCatalog>;
  housekeeper?: HousekeeperContext;
}) => {
  const session = useActiveSession(baseUrl, sessionID, housekeeper);

  if (!sessionID) {
    return (
      <div className="flex flex-1 items-center justify-center text-[11px] opacity-40">
        select or create a session
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PermissionBar requests={session.permissions} onReply={session.replyPermission} />
      <MessageList messages={session.messages} onResend={session.editAndResend} />
      <Composer
        agents={catalog.agents}
        providers={catalog.providers}
        model={session.lastModel}
        agent={session.lastAgent}
        variant={session.lastVariant}
        onModelChange={session.setLastModel}
        onAgentChange={session.setLastAgent}
        onVariantChange={(v) => session.setLastVariant(v ?? null)}
        onSend={(text) => session.send(text)}
      />
    </div>
  );
};
