// A markdown *renderer*, not a parser — deliberately just enough to make
// agent output readable in a small tile: paragraphs, fenced code blocks,
// inline code. No tables/links/headings/lists — those read fine as plain
// text at this size, and every line here goes through React's own escaping
// (`dangerouslySetInnerHTML` is banned app-wide, see AGENTS.md), so there's
// no injection surface even though this is untrusted LLM output.
const CODE_FENCE_RE = /```[\w-]*\n([\s\S]*?)```/g;

const InlineText = ({ text }: { text: string }) => {
  const segments = text.split(/(`[^`]+`)/g);
  return (
    <>
      {segments.map((seg, i) =>
        seg.startsWith("`") && seg.endsWith("`") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments never reorder within a static render
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
            {seg.slice(1, -1)}
          </code>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments never reorder within a static render
          <span key={i}>{seg}</span>
        ),
      )}
    </>
  );
};

export const Markdown = ({ text }: { text: string }) => {
  const parts: Array<{ kind: "text" | "code"; content: string }> = [];
  let last = 0;
  for (const match of text.matchAll(CODE_FENCE_RE)) {
    if (match.index > last) parts.push({ kind: "text", content: text.slice(last, match.index) });
    parts.push({ kind: "code", content: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", content: text.slice(last) });

  return (
    <div className="space-y-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-snug">
      {parts.map((part, i) =>
        part.kind === "code" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder within a static render
          <pre key={i} className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[10.5px] leading-normal">
            <code>{part.content}</code>
          </pre>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder within a static render
          <p key={i}>
            <InlineText text={part.content} />
          </p>
        ),
      )}
    </div>
  );
};
