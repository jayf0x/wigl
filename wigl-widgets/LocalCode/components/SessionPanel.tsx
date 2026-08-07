import { X } from "lucide-react";
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
  onCreate,
}: {
  baseUrl: string | null;
  sessionID: string | null;
  catalog: ReturnType<typeof useModelCatalog>;
  housekeeper?: HousekeeperContext;
  onCreate: () => void;
}) => {
  const session = useActiveSession(baseUrl, sessionID, housekeeper);

  if (!sessionID) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-[11.5px] text-muted-foreground/50">no session open</p>
        <button
          type="button"
          data-no-drag
          onClick={onCreate}
          className="rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors duration-150 hover:border-ring/60 hover:text-foreground"
        >
          new session
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PermissionBar requests={session.permissions} onReply={session.replyPermission} />
      <MessageList messages={session.messages} onResend={session.editAndResend} busy={session.busy} />
      {session.error && (
        <div className="mx-4 mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          <span className="flex-1 truncate">{session.error}</span>
          <button type="button" data-no-drag title="dismiss" onClick={session.dismissError} className="shrink-0">
            <X className="size-3" />
          </button>
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
        onAbort={session.abort}
        busy={session.busy}
      />
    </div>
  );
};
