// Prompt input + the per-turn controls (model, agent, reasoning effort).
// Effort is only offered when the selected model actually has `variants` —
// for an Ollama model that's opencodeConfig.ts's own High/Low pair, written
// only for models `ollama show` reports as thinking-capable (see
// ollama.ts's `modelSupportsThinking`); for any other provider it's
// whatever opencode itself declares. Either way this renders exactly the
// declared keys, it never invents a control the model doesn't have — see
// AGENTS.md's "thinking effort comes from the model, not a fixed enum".
import { useEffect, useMemo, useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AgentDef, ModelSelection, ProviderCatalogEntry } from "../types";

// "off" is a UI-only sentinel — never sent as `variant` (see onValueChange
// below), just what the Select needs for its own "no effort override"
// item, since a Select item can't have an empty-string value.
const EFFORT_OFF = "off";
const REASONING_EFFORT_LABELS: Record<string, string> = { high: "High", low: "Low" };

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
  disabled,
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
  disabled?: boolean;
}) => {
  const [text, setText] = useState("");

  const modelOptions = useMemo(
    () => providers.flatMap((p) => Object.values(p.models).map((m) => ({ ...m, providerName: p.name }))),
    [providers],
  );
  const selectedModel = modelOptions.find((m) => m.providerID === model?.providerID && m.id === model?.modelID);
  // Keys opencodeConfig.ts's `syncOllamaModels` actually writes ("high"/
  // "low") for a thinking-capable Ollama model — a model with no `variants`
  // at all (declared by opencode itself for a non-Ollama provider, or an
  // Ollama model `ollama show` reported as non-thinking) has no effort
  // control, full stop; this widget doesn't invent options a model doesn't
  // have. See REASONING_EFFORT_LABELS below for how a key becomes UI text.
  const variantOptions = selectedModel?.variants ? Object.keys(selectedModel.variants) : [];

  // With ALLOWED_PROVIDER_IDS scoped to Ollama alone, there's often exactly
  // one model available — don't make the user pick it every session.
  useEffect(() => {
    if (!model && modelOptions.length === 1) {
      const only = modelOptions[0];
      onModelChange({ providerID: only.providerID, modelID: only.id });
    }
  }, [model, modelOptions, onModelChange]);

  const submit = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="flex flex-col gap-1.5 border-border/60 border-t px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={model ? `${model.providerID}/${model.modelID}` : undefined}
          onValueChange={(v) => {
            const [providerID, modelID] = String(v).split("/");
            onModelChange({ providerID, modelID });
          }}
        >
          <SelectTrigger className="h-6 w-auto max-w-40 px-2 text-[10.5px]">
            <SelectValue placeholder="model" />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((m) => (
              <SelectItem key={`${m.providerID}/${m.id}`} value={`${m.providerID}/${m.id}`}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={agent ?? undefined} onValueChange={(v) => onAgentChange(String(v))}>
          <SelectTrigger className="h-6 w-auto max-w-32 px-2 text-[10.5px]">
            <SelectValue placeholder="agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.name} value={a.name}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Always visible, not conditionally rendered — a control that only
            appears for some models reads as broken, not as "not
            applicable". Disabled + a placeholder explaining why communicates
            "this model has no reasoning-effort control" instead of hiding
            the concept outright. "Off" is a real, selectable item (not just
            the unset default) — the only way back to no-effort-override
            once you've picked High/Low for a session. */}
        <Select
          value={variantOptions.length > 0 ? (variant ?? EFFORT_OFF) : undefined}
          onValueChange={(v) => onVariantChange(v === EFFORT_OFF ? undefined : String(v))}
          disabled={variantOptions.length === 0}
        >
          <SelectTrigger className="h-6 w-auto max-w-28 px-2 text-[10.5px]">
            <SelectValue placeholder={variantOptions.length > 0 ? "thinking: effort" : "thinking: n/a"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EFFORT_OFF}>thinking: off</SelectItem>
            {variantOptions.map((v) => (
              <SelectItem key={v} value={v}>
                thinking: {REASONING_EFFORT_LABELS[v] ?? v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end gap-1.5">
        <Textarea
          data-no-drag
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="message the agent…"
          disabled={disabled}
          className="min-h-8 flex-1 text-[11.5px]"
        />
        {disabled ? (
          <Button size="icon-sm" variant="destructive" title="stop generating" onClick={onAbort}>
            <Square className="size-3" />
          </Button>
        ) : (
          <Button size="icon-sm" onClick={submit} disabled={!text.trim()}>
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
};
