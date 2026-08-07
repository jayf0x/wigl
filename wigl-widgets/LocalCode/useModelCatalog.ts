// Model + agent metadata for the composer's controls. One fetch per server
// connection (agents/providers don't change mid-session in any way this
// widget needs to react to live) — no SSE subscription needed here, unlike
// sessions/messages.
import { useEffect, useState } from "react";
import * as client from "./client";
import type { AgentDef, ProviderCatalogEntry } from "./types";

export const useModelCatalog = (baseUrl: string | null) => {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!baseUrl) return;
    setLoading(true);
    Promise.all([client.listAgents(baseUrl), client.listProviders(baseUrl)])
      .then(([a, p]) => {
        setAgents(a);
        setProviders(p.providers);
      })
      .catch((e) => console.error("[LocalCode] failed to load model catalog", e))
      .finally(() => setLoading(false));
  }, [baseUrl]);

  return { agents, providers, loading };
};
