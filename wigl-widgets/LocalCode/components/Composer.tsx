// Prompt input + the per-turn controls (model, agent, reasoning effort).
// Effort is only offered when the selected model actually has `variants`
// (see AGENTS.md — "thinking effort comes from the model, not a fixed
// enum") so this never shows a control the model can't honor.
import { useEffect, useMemo, useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AgentDef, ModelSelection, ProviderCatalogEntry } from "../types";

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
            the concept outright. */}
        <Select
          value={variantOptions.length > 0 ? (variant ?? undefined) : undefined}
          onValueChange={(v) => onVariantChange(String(v))}
          disabled={variantOptions.length === 0}
        >
          <SelectTrigger className="h-6 w-auto max-w-28 px-2 text-[10.5px]">
            <SelectValue placeholder={variantOptions.length > 0 ? "thinking: effort" : "thinking: n/a"} />
          </SelectTrigger>
          <SelectContent>
            {variantOptions.map((v) => (
              <SelectItem key={v} value={v}>
                thinking: {v}
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
