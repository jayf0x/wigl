// The transcript. Deliberately not a chat app: no bubbles, no avatars, no
// alternating sides. A turn is a labelled block in one reading column — the
// thing you're doing here is reading and writing code-adjacent prose, so it's
// laid out like a document, and the agent's answer gets the full width while
// your own prompt is quieter and set off by a rule.
//
// No virtualization: instead only the last RENDER_WINDOW messages mount, with
// an explicit "earlier" control for the rest. Same win (a 500-turn session
// doesn't mount 500 collapsible trees) for ~10 lines instead of a windowing
// library that would have to measure streaming, variable-height, individually
// collapsible content. See AGENTS.md's decisions log.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/wigl/utils";
import type { MessageWithParts } from "../types";
import { mergeParts, PartRenderer } from "./PartRenderer";

const RENDER_WINDOW = 40;

// No role labels, no model name, no timestamp. The accent rule down the left
// of a prompt is the only marker a turn needs — everything else was chrome
// competing with the text. ("still too much detail in messages... LESS IS
// MORE" — keep it that way when adding anything here.)
const Turn = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>
);

const UserTurn = ({
  message,
  onResend,
  busy,
}: {
  message: MessageWithParts;
  onResend: (newText: string) => void;
  busy: boolean;
}) => {
  const original = message.parts.find((p) => p.type === "text")?.text ?? "";
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    return (
      <Turn>
        <textarea
          data-no-drag
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.altKey)) {
              setDraft(null);
              onResend(draft);
            }
          }}
          className="min-h-16 w-full resize-none rounded-lg border border-ring/50 bg-background/50 p-2 text-[12.5px] leading-relaxed outline-none"
        />
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="flex-1">⌘↵ resend · esc cancel</span>
          <button type="button" data-no-drag onClick={() => setDraft(null)} className="hover:text-foreground">
            <X className="size-3" />
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => {
              setDraft(null);
              onResend(draft);
            }}
            className="text-primary hover:text-foreground"
          >
            <Check className="size-3" />
          </button>
        </div>
      </Turn>
    );
  }

  return (
    <Turn className="group">
      <div className="flex items-start gap-2">
        <p className="flex-1 whitespace-pre-wrap break-words border-primary/40 border-l-2 pl-2.5 text-[12.5px] leading-relaxed text-foreground/85">
          {original}
        </p>
        <button
          type="button"
          data-no-drag
          title={busy ? "wait for the current reply" : "edit and resend"}
          disabled={busy}
          onClick={() => setDraft(original)}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-60 hover:opacity-100 disabled:opacity-0"
        >
          <Pencil className="size-3" />
        </button>
      </div>
    </Turn>
  );
};

export const MessageList = ({
  messages,
  onResend,
  busy,
}: {
  messages: MessageWithParts[];
  onResend: (messageID: string, newText: string) => void;
  busy: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Follows streaming content down. `messages` gets a fresh identity on every
  // applied SSE event (eventReducer.ts), so this runs per token — instant
  // (non-smooth) scrolling is the only cheap enough option.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const hidden = expanded ? 0 : Math.max(0, messages.length - RENDER_WINDOW);
  const visible = hidden ? messages.slice(hidden) : messages;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-[76ch] flex-col gap-6 px-4 py-5">
        {hidden > 0 && (
          <button
            type="button"
            data-no-drag
            onClick={() => setExpanded(true)}
            className="self-center rounded-md px-2 py-1 text-[10.5px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            {hidden} earlier message{hidden === 1 ? "" : "s"}
          </button>
        )}

        {visible.map((m) =>
          m.info.role === "user" ? (
            <UserTurn key={m.info.id} message={m} onResend={(text) => onResend(m.info.id, text)} busy={busy} />
          ) : (
            <Turn key={m.info.id}>
              <div className="flex flex-col gap-2">
                {mergeParts(m.parts).map((part) => (
                  <PartRenderer key={part.id} part={part} />
                ))}
                {m.info.error && <p className="text-[11.5px] text-destructive/90">{m.info.error.message}</p>}
              </div>
            </Turn>
          ),
        )}

        {/* Shown for the *whole* generating turn, not just the gap before the
            first token — a reply that streams silently into a collapsed
            reasoning trace looked identical to a frozen widget. */}
        {busy && (
          <span className="inline-flex h-3 w-8 items-center gap-1">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                style={{ animationDelay: `${delay}ms` }}
                className="size-1 animate-pulse rounded-full bg-muted-foreground/60"
              />
            ))}
          </span>
        )}

        {messages.length === 0 && !busy && (
          <p className="py-16 text-center text-[11.5px] text-muted-foreground/40">
            type a prompt, or <span className="text-muted-foreground/70">/</span> for commands
          </p>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
};
