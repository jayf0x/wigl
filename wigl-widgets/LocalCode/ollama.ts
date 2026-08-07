// Reachability only (see AGENTS.md's decisions log for why start/stop is
// deferred) — this widget never starts or stops Ollama itself, just shows
// whether it's there so the model picker can grey out `ollama/*` entries.
import { useEffect, useRef, useState } from "react";

const OLLAMA_BASE = "http://127.0.0.1:11434";
const POLL_MS = 10_000;

export const checkOllamaOnline = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
};

export const useOllamaStatus = () => {
  const [online, setOnline] = useState<boolean | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const poll = () => checkOllamaOnline().then((v) => mounted.current && setOnline(v));
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  return online;
};
