import { MessageSquarePlus, X } from "lucide-react";
import { relativeTime } from "@/wigl/utils";
import { useActiveSession } from "../useActiveSession";
import type { useModelCatalog } from "../useModelCatalog";
import type { SessionView } from "../useSessions";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { PermissionBar } from "./PermissionBar";

const RECENT_COUNT = 5;

// Landing view when nothing is open: jump back into a recent session or start
// a new one — no modal, just the last few sessions inline (#11).
const Landing = ({
  recentSessions,
  loading,
  onSelect,
  onCreate,
}: {
  recentSessions: SessionView[];
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) => {
  const recent = recentSessions.slice(0, RECENT_COUNT);
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6">
      <button
        type="button"
        data-no-drag
        onClick={onCreate}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11.5px] text-muted-foreground transition-colors duration-150 hover:border-ring/60 hover:text-foreground"
      >
        <MessageSquarePlus className="size-3.5" />
        new session
      </button>

      {loading ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: RECENT_COUNT }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5">
              <div
                className="h-3 flex-1 animate-pulse rounded bg-muted-foreground/15"
                style={{ maxWidth: `${75 - i * 6}%` }}
              />
            </div>
          ))}
        </div>
      ) : recent.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <span className="px-2 pb-1 text-[9.5px] tracking-[0.14em] text-muted-foreground/50 uppercase">recent</span>
          {recent.map((s) => (
            <button
              key={s.id}
              type="button"
              data-no-drag
              onClick={() => onSelect(s.id)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors duration-150 hover:bg-muted/40 hover:text-foreground"
            >
              <span className="min-w-0 flex-1 truncate">{s.displayTitle}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground/40">
                {relativeTime(s.time.updated / 1000)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-center text-[11px] text-muted-foreground/40">no sessions yet</p>
      )}
    </div>
  );
};

export const SessionPanel = ({
  baseUrl,
  sessionID,
  catalog,
  recentSessions,
  sessionsLoading,
  onSelect,
  onCreate,
  onFirstMessage,
}: {
  baseUrl: string | null;
  sessionID: string | null;
  catalog: ReturnType<typeof useModelCatalog>;
  recentSessions: SessionView[];
  sessionsLoading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onFirstMessage: (sessionID: string, text: string) => void;
}) => {
  const session = useActiveSession(baseUrl, sessionID);

  if (!sessionID) {
    return (
      <Landing recentSessions={recentSessions} loading={sessionsLoading} onSelect={onSelect} onCreate={onCreate} />
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PermissionBar requests={session.permissions} onReply={session.replyPermission} />
      {session.loading && session.messages.length === 0 ? (
        <div className="mx-auto flex w-full max-w-[76ch] flex-1 flex-col gap-4 px-4 py-5">
          {[90, 60, 75].map((w, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-3 w-16 animate-pulse rounded bg-muted-foreground/15" />
              <div className="h-3 animate-pulse rounded bg-muted-foreground/10" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      ) : (
        <MessageList messages={session.messages} onResend={session.editAndResend} busy={session.busy} />
      )}
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
        onSend={(text) => {
          // Captured before `send` (which only takes effect once the
          // server round-trips), not after — `session.messages` reflects
          // *this* turn's history right up until send() resolves. Not
          // gated on `!session.loading`: a brand-new session's initial
          // history fetch (useActiveSession.ts) can still be in flight
          // when the user types fast, and this only ever fires once per
          // session anyway (onFirstMessage's own `sessionID in titles`
          // guard) — gating on `loading` risked missing that one shot
          // permanently, leaving the session titled "Empty #N" forever.
          const isFirstMessage = session.messages.length === 0;
          session.send(text);
          if (isFirstMessage) onFirstMessage(sessionID, text);
        }}
        onAbort={session.abort}
        busy={session.busy}
      />
    </div>
  );
};
