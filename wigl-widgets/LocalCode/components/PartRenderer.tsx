// One case per opencode part `type` (see types.ts's `PartType`) — mirrors
// how OpenGUI dispatches part rendering, just collapsed to what fits a
// small tile. Deliberately no diff view (AGENTS.md's decisions log) — a
// `patch` part gets a one-line "N files changed" summary, nothing more.
import { type ReactNode, useState } from "react";
import { ChevronRight, Loader2, ListTodo, Sparkles, Wrench } from "lucide-react";
import { cn } from "@/wigl/utils";
import type { MessagePart } from "../types";
import { Markdown } from "./Markdown";

const Collapsible = ({
  icon: Icon,
  label,
  defaultOpen = false,
  children,
}: {
  icon: typeof ChevronRight;
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border/50">
      <button
        type="button"
        data-no-drag
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[10.5px] opacity-60 hover:opacity-90"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        <Icon className="size-3" />
        <span className="truncate">{label}</span>
      </button>
      {open && <div className="border-border/50 border-t px-2 py-1.5">{children}</div>}
    </div>
  );
};

export const PartRenderer = ({ part }: { part: MessagePart }) => {
  switch (part.type) {
    case "text":
      return part.text?.trim() ? <Markdown text={part.text} /> : null;

    case "reasoning":
      if (!part.text?.trim()) return null;
      return (
        <Collapsible icon={Sparkles} label={part.time?.end ? "thinking" : "thinking…"}>
          <Markdown text={part.text} />
        </Collapsible>
      );

    case "tool": {
      const running = part.state?.status === "running" || part.state?.status === "pending";
      return (
        <Collapsible
          icon={running ? Loader2 : Wrench}
          label={`${part.tool ?? "tool"}${part.state?.status ? ` — ${part.state.status}` : ""}`}
        >
          {part.state?.error ? (
            <div className="text-[10.5px] text-destructive/80">{part.state.error}</div>
          ) : part.state?.output ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
              {part.state.output}
            </pre>
          ) : (
            <div className="text-[10.5px] opacity-40">no output yet</div>
          )}
        </Collapsible>
      );
    }

    case "subtask":
      return (
        <div className="flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1 text-[10.5px] opacity-70">
          <Sparkles className="size-3" />
          <span>
            sub-agent <span className="font-medium">{part.agent ?? "?"}</span>
            {part.description ? ` — ${part.description}` : ""}
          </span>
        </div>
      );

    case "patch":
      return (
        <div className="text-[10.5px] opacity-50">
          {part.files?.length ? `${part.files.length} file${part.files.length === 1 ? "" : "s"} changed` : "edited files"}
        </div>
      );

    case "step-start":
    case "step-finish":
    case "snapshot":
    case "retry":
    case "compaction":
    case "agent":
    case "file":
      return null; // structural/bookkeeping parts — nothing worth a line in this tile

    default:
      return null;
  }
};

export const TodoBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <span className="flex items-center gap-1 text-[10px] opacity-50">
      <ListTodo className="size-3" />
      {count}
    </span>
  ) : null;
