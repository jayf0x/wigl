// The composer: one auto-growing markdown-aware editor and a row of tiny
// status chips. Each chip is *both* the current-state readout and its own
// control — clicking it opens a dropdown to change model / agent / reasoning
// effort. No slash commands: those used to double as the settings UI, but a
// command that overwrites what you're typing and fights its own popover isn't
// an intuitive flow (owner's call) — the chips already have UI, so a "/" is
// now just literal text the agent receives.
//
// Enter never submits. ⌘/Ctrl/⌥+Enter does. Owner's call, and the right one
// for a field you're expected to write real multi-line prompts in.
//
// The field itself is Milkdown's Crepe editor (`CrepeField.tsx`), not a
// `<textarea>` — WYSIWYG markdown, with native Tab/Shift+Tab list nesting and
// Enter-continues/exits-a-list. Its stylesheet (`composer.css`) rides the
// host's plugin CSS pipeline.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, Brain, Cpu, type LucideIcon, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/wigl/utils";
import { DEFAULT_CHAT_AGENT } from "../config";
import type { AgentDef, ModelSelection, ProviderCatalogEntry } from "../types";
import { CrepeField, type CrepeHandle } from "./CrepeField";
import "./composer.css";

// `off` is a real variant now (opencodeConfig.ts maps it to Ollama's
// `reasoning_effort: "none"`, the one value that actually suppresses
// thinking), always offered first regardless of what the
// model's own `variants` map declares. Effort keys themselves are otherwise
// per-model (see below); this is only the display map for the ones we know
// by name.
const EFFORT_OFF = "off";
const EFFORT_LABELS: Record<string, string> = { off: "off", low: "low", high: "high" };

// opencode's own hidden toolless agent (see housekeeper.ts) — the one thing
// guaranteed not to attach a tool schema, so it's what a tool-incapable
// model gets forced onto instead of 400ing on the default `build` agent.
const TOOLLESS_AGENT = "title";

interface Option {
  value: string;
  label: string;
  hint?: string;
}

// A chip that is its own dropdown: reads the current value, opens a menu to
// change it. Selecting sets the value and closes — it never touches the
// composer text.
const ChipMenu = ({
  icon: Icon,
  label,
  title,
  muted,
  disabled,
  options,
  selectedValue,
  onSelect,
  clearLabel,
  onClear,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  muted?: boolean;
  disabled?: boolean;
  options: Option[];
  selectedValue?: string;
  onSelect: (value: string) => void;
  /** Row label for resetting to "nothing explicitly chosen" — omit to make
   * this chip select-only, no way back to unset once picked. */
  clearLabel?: string;
  onClear?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open && !disabled} onOpenChange={(next) => setOpen(next && !disabled)}>
      <PopoverTrigger
        data-no-drag
        title={title}
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors duration-150",
          "text-muted-foreground hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground",
          (muted || disabled) && "opacity-40",
          disabled && "cursor-default hover:bg-transparent hover:text-muted-foreground",
        )}
      >
        <Icon className="size-3" />
        <span className="max-w-28 truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="max-h-64 w-56 gap-0 overflow-y-auto p-1">
        {onClear && (
          <button
            type="button"
            data-no-drag
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            title={clearLabel}
            className={cn(
              "flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] transition-colors duration-100",
              selectedValue === undefined
                ? "bg-primary/15 text-foreground"
                : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="flex-1 truncate italic">{clearLabel}</span>
          </button>
        )}
        {options.length === 0 ? (
          <span className="px-2 py-1.5 text-[11px] text-muted-foreground/50">none available</span>
        ) : (
          options.map((o) => (
            <button
              key={o.value}
              type="button"
              data-no-drag
              onClick={() => {
                onSelect(o.value);
                setOpen(false);
              }}
              title={o.hint ? `${o.label} — ${o.hint}` : o.label}
              className={cn(
                "flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] transition-colors duration-100",
                o.value === selectedValue
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="truncate">{o.label}</span>
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
};

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
  onAgentChange: (a: string | null) => void;
  onVariantChange: (v: string | undefined) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  busy: boolean;
}) => {
  const [text, setText] = useState("");
  const crepeRef = useRef<CrepeHandle | null>(null);

  const modelOptions = useMemo<Option[]>(
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
  // `off` is filtered out here since it's prepended below as `EFFORT_OFF` —
  // the config declares it as a real variant (opencodeConfig.ts) but the UI
  // still treats it as the one fixed, always-first option.
  const efforts = selected?.variants ? Object.keys(selected.variants).filter((k) => k !== EFFORT_OFF) : [];
  const effortOptions: Option[] = [EFFORT_OFF, ...efforts].map((v) => ({ value: v, label: EFFORT_LABELS[v] ?? v }));
  // `/agent` lists opencode's internal agents alongside real ones — `title`/
  // `summary`/`compaction` come back `hidden: true` (never meant to be
  // chosen directly, see housekeeper.ts), `explore`/`general` are
  // `mode: "subagent"` (spawned by a primary agent's task tool, not
  // selectable as the main one), and `DEFAULT_CHAT_AGENT` is what "nothing
  // picked" already sends — showing it as a selectable option too would be
  // a confusing duplicate of the chip's own clear/default state. None of
  // these belong in this picker.
  const agentOptions: Option[] = agents
    .filter((a) => !a.hidden && a.mode !== "subagent" && a.name !== DEFAULT_CHAT_AGENT)
    .map((a) => ({
      value: a.name,
      label: a.name,
      hint: a.description,
    }));

  // A tool-incapable model 400s the moment `build` (or any tool-using agent)
  // is attached — `ProviderModel.capabilities.toolcall` already tells us
  // this per-model, so force the toolless fallback rather than let the user
  // pick an agent that's guaranteed to error.
  const toolless = selected?.capabilities.toolcall === false;

  // With ALLOWED_PROVIDER_IDS scoped to Ollama alone there's often exactly
  // one model installed — don't make anyone open a menu to pick it.
  useEffect(() => {
    if (!model && modelOptions.length === 1) {
      const [providerID, ...rest] = modelOptions[0].value.split("/");
      onModelChange({ providerID, modelID: rest.join("/") });
    }
  }, [model, modelOptions, onModelChange]);

  useEffect(() => {
    if (toolless && agent !== TOOLLESS_AGENT) onAgentChange(TOOLLESS_AGENT);
  }, [toolless, agent, onAgentChange]);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
  };

  // Mod/Alt-Enter must beat ProseMirror to the Enter key. A capture-phase
  // handler on the editor's wrapper runs before ProseMirror's own keydown
  // listener; stopPropagation there halts the descent so Milkdown never
  // inserts a newline for the send chord. See CrepeField.tsx.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey || e.altKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  };

  return (
    <div className="shrink-0 px-4 pb-3">
      <div
        data-no-drag
        className="rounded-xl border border-border bg-background/40 transition-colors duration-200 focus-within:border-ring/60"
      >
        <CrepeField
          value={text}
          onChange={setText}
          placeholder={busy ? "…" : "ask anything"}
          handleRef={crepeRef}
          onKeyDownCapture={onKeyDownCapture}
          className="composer-editor w-full"
        />

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <ChipMenu
            icon={Cpu}
            label={selected?.name ?? "no model"}
            title="model"
            muted={!selected}
            options={modelOptions}
            selectedValue={model ? `${model.providerID}/${model.modelID}` : undefined}
            onSelect={(value) => {
              const [providerID, ...rest] = value.split("/");
              onModelChange({ providerID, modelID: rest.join("/") });
            }}
          />
          <ChipMenu
            icon={Bot}
            label={toolless ? TOOLLESS_AGENT : (agent ?? "default")}
            title={
              toolless
                ? "agent (no tools — model can't use them)"
                : (agent ?? `agent (default: ${DEFAULT_CHAT_AGENT} — no tools)`)
            }
            disabled={toolless}
            options={agentOptions}
            selectedValue={agent ?? undefined}
            onSelect={onAgentChange}
            clearLabel="default (no tools)"
            onClear={() => onAgentChange(null)}
          />
          {efforts.length > 0 && (
            <ChipMenu
              icon={Brain}
              label={EFFORT_LABELS[variant ?? EFFORT_OFF] ?? (variant as string)}
              title="reasoning effort"
              muted={!variant}
              options={effortOptions}
              selectedValue={variant ?? EFFORT_OFF}
              onSelect={onVariantChange}
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
              disabled={!text.trim()}
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
