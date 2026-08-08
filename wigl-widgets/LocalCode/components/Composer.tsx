// The composer: one auto-growing markdown-aware editor, a slash-command
// palette, and a single line of tiny status chips. No dropdowns —
// model/agent/effort are all `/model`, `/agent`, `/think` (see commands.ts
// for why). The chips are both the current-state readout *and* the
// discovery path: clicking one types its command for you, so nothing needs
// a menu to be findable.
//
// Enter never submits. ⌘/Ctrl/⌥+Enter does. Owner's call, and the right one
// for a field you're expected to write real multi-line prompts in.
//
// The field itself is Milkdown's Crepe editor (`CrepeField.tsx`), not a
// `<textarea>` — WYSIWYG markdown, with native Tab/Shift+Tab list nesting and
// Enter-continues/exits-a-list. Its stylesheet (`composer.css`) rides the
// host's plugin CSS pipeline. Enter never submits; the slash palette owns its
// keys via a capture-phase handler that beats ProseMirror to them.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, Brain, Cpu, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/wigl/utils";
import {
  COMMANDS,
  type CommandOption,
  EFFORT_LABELS,
  EFFORT_OFF,
  filterOptions,
  parseCommand,
  resolveCommand,
} from "../commands";
import type { AgentDef, ModelSelection, ProviderCatalogEntry } from "../types";
import { CrepeField, type CrepeHandle } from "./CrepeField";
import "./composer.css";

const Chip = ({
  icon: Icon,
  label,
  title,
  muted,
  onClick,
}: {
  icon: typeof Cpu;
  label: string;
  title: string;
  muted?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    data-no-drag
    title={title}
    onClick={onClick}
    className={cn(
      "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors duration-150",
      "text-muted-foreground hover:bg-muted hover:text-foreground",
      muted && "opacity-40",
    )}
  >
    <Icon className="size-3" />
    <span className="max-w-28 truncate">{label}</span>
  </button>
);

export const Composer = ({
  agents,
  providers,
  model,
  agent,
  variant,
  onModelChange,
  onAgentChange,
  onVariantChange,
  onSend,
  onAbort,
  busy,
}: {
  agents: AgentDef[];
  providers: ProviderCatalogEntry[];
  model: ModelSelection | null;
  agent: string | null;
  variant: string | null;
  onModelChange: (m: ModelSelection) => void;
  onAgentChange: (a: string) => void;
  onVariantChange: (v: string | undefined) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  busy: boolean;
}) => {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0); // highlighted palette row
  const crepeRef = useRef<CrepeHandle | null>(null);
  const pendingFocusRef = useRef(false);

  const models = useMemo(
    () =>
      providers.flatMap((p) =>
        Object.values(p.models).map((m) => ({
          value: `${m.providerID}/${m.id}`,
          label: m.name,
          hint: p.name,
        })),
      ),
    [providers],
  );
  const selected = useMemo(
    () =>
      providers
        .flatMap((p) => Object.values(p.models))
        .find((m) => m.providerID === model?.providerID && m.id === model?.modelID),
    [providers, model],
  );
  // Effort keys come from the model's own `variants` map — never a hardcoded
  // low/medium/high list (AGENTS.md). No variants ⇒ no effort control at all.
  const efforts = selected?.variants ? Object.keys(selected.variants) : [];

  // With ALLOWED_PROVIDER_IDS scoped to Ollama alone there's often exactly
  // one model installed — don't make anyone type /model to pick it.
  useEffect(() => {
    if (!model && models.length === 1) {
      const [providerID, ...rest] = models[0].value.split("/");
      onModelChange({ providerID, modelID: rest.join("/") });
    }
  }, [model, models, onModelChange]);

  const parsed = parseCommand(text);
  const active = parsed?.hasArg ? resolveCommand(parsed.name) : null;
  const options: CommandOption[] = useMemo(() => {
    if (!parsed) return [];
    if (!active) {
      return filterOptions(
        COMMANDS.map((c) => ({ value: c.name, label: `/${c.name}`, hint: c.hint })),
        parsed.name,
      );
    }
    const all: CommandOption[] =
      active.name === "model"
        ? models
        : active.name === "agent"
          ? agents.map((a) => ({ value: a.name, label: a.name, hint: a.description?.slice(0, 40) }))
          : [EFFORT_OFF, ...efforts].map((v) => ({ value: v, label: EFFORT_LABELS[v] ?? v }));
    return filterOptions(all, parsed.query);
  }, [parsed?.name, parsed?.query, active, models, agents, efforts]);

  const paletteOpen = Boolean(parsed) && options.length > 0;
  const index = Math.min(cursor, options.length - 1);

  const type = (prefix: string) => {
    setText(prefix);
    setCursor(0);
    pendingFocusRef.current = true;
  };

  const apply = (option: CommandOption) => {
    if (!active) {
      type(`/${option.value} `);
      return;
    }
    if (active.name === "model") {
      const [providerID, ...rest] = option.value.split("/");
      onModelChange({ providerID, modelID: rest.join("/") });
    } else if (active.name === "agent") {
      onAgentChange(option.value);
    } else {
      onVariantChange(option.value === EFFORT_OFF ? undefined : option.value);
    }
    setText("");
    setCursor(0);
    pendingFocusRef.current = true;
  };

  const submit = () => {
    if (!text.trim() || busy || parsed) return;
    onSend(text);
    setText("");
  };

  // Focus (caret to end) after `type()`/`apply()` sets `text` programmatically
  // — deferred to an effect because CrepeField only picks up the new `value`
  // once its own (child) sync effect has run, which happens before this one on
  // the same commit.
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    crepeRef.current?.focusEnd();
  }, [text]);

  const moveDown = () => setCursor((c) => (Math.min(c, options.length - 1) + 1) % options.length);
  const moveUp = () =>
    setCursor((c) => (Math.min(c, options.length - 1) + options.length - 1) % options.length);

  // The slash palette (and Mod/Alt-Enter send) must beat ProseMirror to these
  // keys. A capture-phase handler on the editor's wrapper runs before
  // ProseMirror's own keydown listener on the inner contentEditable; calling
  // stopPropagation there halts the descent so Milkdown never sees the key.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey || e.altKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submit();
      return;
    }
    if (!paletteOpen) return;
    const take = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
        take();
        moveDown();
        break;
      case "ArrowUp":
        take();
        moveUp();
        break;
      case "Tab":
        take();
        e.shiftKey ? moveUp() : moveDown();
        break;
      case "Enter": {
        take();
        const o = options[index];
        if (o) apply(o);
        break;
      }
      case "Escape":
        take();
        setText("");
        break;
    }
  };

  return (
    <div className="relative shrink-0 px-4 pb-3">
      {paletteOpen && (
        <div className="absolute inset-x-4 bottom-full z-10 mb-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {options.slice(0, 8).map((o, i) => (
            <button
              key={o.value}
              type="button"
              data-no-drag
              onMouseEnter={() => setCursor(i)}
              onClick={() => apply(o)}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors duration-100",
                i === index ? "bg-primary/15 text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 truncate text-[10px] opacity-40">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}

      <div
        data-no-drag
        className="rounded-xl border border-border bg-background/40 transition-colors duration-200 focus-within:border-ring/60"
      >
        <CrepeField
          value={text}
          onChange={(value) => {
            setText(value);
            setCursor(0);
          }}
          placeholder={busy ? "…" : "ask, or / for commands"}
          handleRef={crepeRef}
          onKeyDownCapture={onKeyDownCapture}
          className="composer-editor w-full"
        />

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <Chip
            icon={Cpu}
            label={selected?.name ?? "no model"}
            title="model — /model"
            muted={!selected}
            onClick={() => type("/model ")}
          />
          <Chip icon={Bot} label={agent ?? "build"} title="agent — /agent" onClick={() => type("/agent ")} />
          {efforts.length > 0 && (
            <Chip
              icon={Brain}
              label={EFFORT_LABELS[variant ?? EFFORT_OFF] ?? (variant as string)}
              title="reasoning effort — /think"
              muted={!variant}
              onClick={() => type("/think ")}
            />
          )}
          <div className="flex-1" />
          {busy ? (
            <Button size="icon-xs" variant="ghost" title="stop generating" onClick={onAbort} data-no-drag>
              <Square className="size-3 fill-current text-destructive" />
            </Button>
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              data-no-drag
              title="send — ⌘↵ / ctrl↵"
              disabled={!text.trim() || Boolean(parsed)}
              onClick={submit}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowUp className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
