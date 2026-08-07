// Model + agent metadata for the composer's controls. One fetch per server
// connection (agents/providers don't change mid-session in any way this
// widget needs to react to live) — no SSE subscription needed here, unlike
// sessions/messages.
import { useCallback, useEffect, useState } from "react";
import * as client from "./client";
import { ALLOWED_PROVIDER_IDS } from "./config";
import type { AgentDef, ProviderCatalogEntry } from "./types";

export const useModelCatalog = (baseUrl: string | null) => {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!baseUrl) return;
    setLoading(true);
    Promise.all([client.listAgents(baseUrl), client.listProviders(baseUrl)])
      .then(([a, p]) => {
        setAgents(a);
        // Scoped to ALLOWED_PROVIDER_IDS (see config.ts) — opencode's
        // `opencode` (Zen) provider is active out of the box with no setup,
        // which read as "predefined models" rather than "reliant on
        // Ollama" until this was filtered out.
        setProviders(p.providers.filter((entry) => ALLOWED_PROVIDER_IDS.includes(entry.id)));
      })
      .catch((e) => console.error("[LocalCode] failed to load model catalog", e))
      .finally(() => setLoading(false));
  }, [baseUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, providers, loading, refresh };
};
