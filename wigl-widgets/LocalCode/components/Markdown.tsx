// Renders markdown.ts's tokens. Every string lands as a React child, never
// as HTML — see markdown.ts's header for why that's non-negotiable here.
import { Fragment } from "react";
import { cn } from "@/wigl/utils";
import { type Block, parseBlocks, type Span } from "../markdown";

const Spans = ({ spans }: { spans: Span[] }) => (
  <>
    {spans.map((s, i) => {
      // biome-ignore lint/suspicious/noArrayIndexKey: spans never reorder within a static render
      const key = i;
      if (s.kind === "code")
        return (
          <code key={key} className="rounded bg-muted px-1 py-px font-mono text-[0.9em] text-foreground/90">
            {s.text}
          </code>
        );
      if (s.kind === "strong")
        return (
          <strong key={key} className="font-semibold text-foreground">
            {s.text}
          </strong>
        );
      if (s.kind === "em")
        return (
          <em key={key} className="italic">
            {s.text}
          </em>
        );
      // Not an anchor: nothing in a desktop widget should navigate the
      // webview, and opening a browser is a capability this widget doesn't
      // hold. The href is still visible on hover.
      if (s.kind === "link")
        return (
          <span key={key} className="text-primary underline decoration-primary/30 underline-offset-2" title={s.href}>
            {s.text}
          </span>
        );
      return <Fragment key={key}>{s.text}</Fragment>;
    })}
  </>
);

const BlockView = ({ block }: { block: Block }) => {
  switch (block.kind) {
    case "code":
      return (
        <div className="group/code relative overflow-hidden rounded-lg border border-border/60 bg-background/60">
          {block.lang && (
            <span className="absolute top-1 right-2 text-[9px] tracking-wider text-muted-foreground/50 uppercase">
              {block.lang}
            </span>
          )}
          <pre className="overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed">
            <code>{block.content}</code>
          </pre>
        </div>
      );
    case "heading":
      return (
        <p
          className={cn(
            "font-semibold text-foreground",
            block.level <= 2 ? "text-[13px]" : "text-[12px] text-foreground/80",
          )}
        >
          <Spans spans={block.spans} />
        </p>
      );
    case "list":
      return (
        <ul className="flex flex-col gap-0.5 pl-1">
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items never reorder within a static render
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/60 tabular-nums">{block.ordered ? `${i + 1}.` : "·"}</span>
              <span className="flex-1">
                <Spans spans={item} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <p className="border-border border-l-2 pl-2.5 text-muted-foreground italic">
          <Spans spans={block.spans} />
        </p>
      );
    case "rule":
      return <hr className="border-border/60" />;
    default:
      return (
        <p>
          <Spans spans={block.spans} />
        </p>
      );
  }
};

export const Markdown = ({ text, className }: { text: string; className?: string }) => (
  <div className={cn("flex flex-col gap-2 break-words text-[12.5px] leading-relaxed", className)}>
    {parseBlocks(text).map((block, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: blocks never reorder within a static render
      <BlockView key={i} block={block} />
    ))}
  </div>
);
