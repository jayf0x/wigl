import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      {session.error && (
        <div className="flex items-center gap-2 border-destructive/30 border-t bg-destructive/10 px-2 py-1.5 text-[10.5px] text-destructive">
          <span className="flex-1 truncate">{session.error}</span>
          <Button size="icon-xs" variant="ghost" title="dismiss" onClick={session.dismissError}>
            <X className="size-3" />
          </Button>
        </div>
      )}
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
        disabled={session.busy}
      />
    </div>
  );
};
