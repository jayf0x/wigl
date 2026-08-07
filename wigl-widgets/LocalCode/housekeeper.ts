// The "housekeeper" model: a small/fast/local model (default
// ollama/smollm:135m, see config.ts's DEFAULT_HOUSEKEEPER_MODEL) used for
// small internal tasks — session titles today, more later (greeting text,
// etc. — see TODO.md) — so those never cost a real turn against whatever
// model the user is actually working with. Runs in its own scratch
// session, deleted afterward; the user never sees it as a session.
import * as client from "./client";
import type { ModelSelection } from "./types";

const HOUSEKEEPER_TIMEOUT_MS = 15_000;

/** Sends `prompt` to a throwaway session on `model` and resolves with the
 * assistant's full text response. Waits for `session.idle` (the turn is
 * fully done, not just started) rather than polling — same event this
 * widget already subscribes to for real sessions. Always cleans up the
 * scratch session, even on timeout/error.
 *
 * `agent` matters more than it looks: a session with no `agent` defaults to
 * `"build"`, which always attaches opencode's full tool schema to the
 * completion request — verified live that Ollama 400s with "does not
 * support tools" for small models that don't support function-calling at
 * all (`smollm:135m`, the housekeeper default, is one of them). Callers
 * doing a plain text-in/text-out task should pass a toolless native agent
 * (`"title"`, `"summary"`, ...) rather than leaving this unset. */
export const runHousekeeperPrompt = async (
  baseUrl: string,
  model: ModelSelection,
  prompt: string,
  directory: string,
  agent?: string,
): Promise<string | null> => {
  const session = await client.createSession(baseUrl, { directory });
  try {
    const result = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), HOUSEKEEPER_TIMEOUT_MS);
      const unsubscribe = client.subscribeEvents(baseUrl, (event) => {
        if (event.type === "session.idle" && event.properties.sessionID === session.id) {
          client
            .listMessages(baseUrl, session.id)
            .then((messages) => {
              const assistant = [...messages].reverse().find((m) => m.info.role === "assistant");
              const text = assistant?.parts
                .filter((p) => p.type === "text" && p.text)
                .map((p) => p.text)
                .join("")
                .trim();
              finish(text || null);
            })
            .catch(() => finish(null));
        } else if (event.type === "session.error" && event.properties.sessionID === session.id) {
          finish(null);
        }
      });
      client.sendPrompt(baseUrl, session.id, { text: prompt, model, agent }).catch(() => finish(null));
    });
    return result;
  } finally {
    client.deleteSession(baseUrl, session.id).catch(() => {});
  }
};

/** A short (≤ a handful of words) title for `firstPrompt` — the concrete
 * first use of the housekeeper model. Falls back to `null` on any failure
 * (timeout, empty Ollama response, ...); callers keep whatever title they
 * already had in that case, they never block or show an error over this. */
export const generateSessionTitle = async (
  baseUrl: string,
  model: ModelSelection,
  firstPrompt: string,
  directory: string,
): Promise<string | null> => {
  const instruction = `Summarize the following request as a short title, 3 to 6 words, no punctuation, no quotes, plain text only:\n\n${firstPrompt}`;
  // opencode's own hidden "title" agent — toolless (see runHousekeeperPrompt's
  // doc comment) and already prompted for exactly this job.
  const raw = await runHousekeeperPrompt(baseUrl, model, instruction, directory, "title");
  if (!raw) return null;
  const cleaned = raw
    .replace(/["'*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 60 ? `${cleaned.slice(0, 60).trimEnd()}…` : cleaned || null;
};
