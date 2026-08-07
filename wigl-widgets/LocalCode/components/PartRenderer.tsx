// One case per opencode part `type` (types.ts's `PartType`). Everything that
// isn't the answer itself renders as a *trace row*: a single dim line you can
// expand, never a card competing with the reply for attention. Expanded
// content is height-capped and scrolls — a long reasoning trace used to push
// the transcript down several screens on its own.
import { type ReactNode, useState } from "react";
import { ChevronRight, Loader2, ListTodo, Sparkles, Terminal } from "lucide-react";
import { cn } from "@/wigl/utils";
import type { MessagePart } from "../types";
import { Markdown } from "./Markdown";

const Trace = ({
  icon: Icon,
  label,
  meta,
  spin,
  children,
}: {
  icon: typeof ChevronRight;
  label: string;
  meta?: string;
  spin?: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        data-no-drag
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-1.5 py-0.5 text-left text-[10.5px] text-muted-foreground/70 transition-colors duration-150 hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 opacity-50 transition-transform duration-200", open && "rotate-90")}
        />
        <Icon className={cn("size-3 shrink-0", spin && "animate-spin")} />
        <span className="truncate">{label}</span>
        {meta && <span className="shrink-0 truncate opacity-50">{meta}</span>}
      </button>
      {open && (
        <div className="mt-1 mb-1.5 ml-1.5 max-h-56 overflow-y-auto border-border border-l pl-3 text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
};

const duration = (time?: { start?: number; end?: number }) => {
  if (!time?.start || !time?.end) return undefined;
  const secs = (time.end - time.start) / 1000;
  return secs >= 1 ? `${secs.toFixed(secs < 10 ? 1 : 0)}s` : undefined;
};

export const PartRenderer = ({ part }: { part: MessagePart }) => {
  switch (part.type) {
    case "text":
      return part.text?.trim() ? <Markdown text={part.text} /> : null;

    case "reasoning":
      if (!part.text?.trim()) return null;
      return (
        <Trace
          icon={Sparkles}
          label={part.time?.end ? "thought" : "thinking"}
          meta={duration(part.time)}
          spin={!part.time?.end}
        >
          <Markdown text={part.text} className="text-[11.5px] opacity-80" />
        </Trace>
      );

    case "tool": {
      const running = part.state?.status === "running" || part.state?.status === "pending";
      const failed = part.state?.status === "error";
      return (
        <Trace
          icon={running ? Loader2 : Terminal}
          spin={running}
          label={part.tool ?? "tool"}
          meta={failed ? "failed" : running ? "running" : undefined}
        >
          {part.state?.error ? (
            <p className="text-[11px] text-destructive/90">{part.state.error}</p>
          ) : part.state?.output ? (
            <pre className="whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed">{part.state.output}</pre>
          ) : (
            <p className="text-[11px] opacity-40">no output</p>
          )}
        </Trace>
      );
    }

    case "subtask":
      return (
        <div className="flex items-center gap-1.5 py-0.5 text-[10.5px] text-muted-foreground/70">
          <Sparkles className="size-3" />
          <span className="truncate">
            sub-agent <span className="text-foreground/80">{part.agent ?? "?"}</span>
            {part.description ? ` — ${part.description}` : ""}
          </span>
        </div>
      );

    case "patch":
      return (
        <div className="py-0.5 text-[10.5px] text-muted-foreground/60">
          {part.files?.length ? `${part.files.length} file${part.files.length === 1 ? "" : "s"} changed` : "edited files"}
        </div>
      );

    default:
      return null; // structural/bookkeeping parts — nothing worth a line here
  }
};

export const TodoBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
      <ListTodo className="size-3" />
      {count}
    </span>
  ) : null;
