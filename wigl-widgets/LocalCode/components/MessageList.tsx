// The transcript. User messages are editable in place (pencil → textarea →
// resend, see AGENTS.md's "edit and resend" note); assistant messages just
// render their parts. No virtualization yet — see AGENTS.md's backlog for
// why that's deliberately deferred rather than half-built.
import { useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/wigl/utils";
import type { MessageWithParts } from "../types";
import { PartRenderer } from "./PartRenderer";

const EditableUserMessage = ({
  message,
  onResend,
}: {
  message: MessageWithParts;
  onResend: (newText: string) => void;
}) => {
  const originalText = message.parts.find((p) => p.type === "text")?.text ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(originalText);

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <Textarea
          data-no-drag
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-14 text-[11.5px]"
        />
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
            cancel
          </Button>
          <Button
            size="xs"
            variant="default"
            onClick={() => {
              setEditing(false);
              onResend(draft);
            }}
          >
            <RotateCcw className="size-3" /> resend
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-1.5">
      <p className="flex-1 whitespace-pre-wrap break-words text-[11.5px] leading-snug">{originalText}</p>
      <button
        type="button"
        data-no-drag
        title="edit and resend"
        onClick={() => {
          setDraft(originalText);
          setEditing(true);
        }}
        className="shrink-0 opacity-0 hover:opacity-90 group-hover:opacity-40"
      >
        <Pencil className="size-3" />
      </button>
    </div>
  );
};

export const MessageList = ({
  messages,
  onResend,
}: {
  messages: MessageWithParts[];
  onResend: (messageID: string, newText: string) => void;
}) => (
  <ScrollArea className="flex-1">
    <div className="flex flex-col gap-2 px-2.5 py-2">
      {messages.map((m) => (
        <div
          key={m.info.id}
          className={cn(
            "max-w-[92%] rounded-lg px-2.5 py-1.5",
            m.info.role === "user" ? "ml-auto bg-primary/10" : "mr-auto bg-muted/60",
          )}
        >
          {m.info.role === "user" ? (
            <EditableUserMessage message={m} onResend={(text) => onResend(m.info.id, text)} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {m.parts.map((part) => (
                <PartRenderer key={part.id} part={part} />
              ))}
              {m.info.error && <p className="text-[10.5px] text-destructive/80">{m.info.error.message}</p>}
            </div>
          )}
        </div>
      ))}
      {messages.length === 0 && <p className="px-1 py-6 text-center text-[11px] opacity-40">no messages yet</p>}
    </div>
  </ScrollArea>
);
