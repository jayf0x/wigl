// Slash commands *are* this widget's settings UI — there are no dropdowns
// for model/agent/effort anymore. Rationale (owner's, verbatim): "the current
// UI just feels clumsy... change all these settings to commands: even model
// selection and reasoning become commands like /model qwen3.5".
//
// Everything here is pure string work so the matching rules are testable
// without a React runtime (docs/principles.md's functional core) — see
// tests/commands.test.ts. The Composer owns only the keyboard/rendering half.

export interface CommandOption {
  value: string;
  label: string;
  /** Right-aligned dim text in the palette — provider, mode, description. */
  hint?: string;
}

export interface CommandSpec {
  name: string;
  hint: string;
}

export const COMMANDS: CommandSpec[] = [
  { name: "model", hint: "switch model" },
  { name: "agent", hint: "switch agent" },
  { name: "think", hint: "reasoning effort" },
];

/** Effort levels are per-model (a model with no `variants` gets none — see
 * AGENTS.md), so this is only the label map; the real list comes from the
 * selected model's catalog entry. `off` is the "no override" sentinel and is
 * never sent as a `variant`. */
export const EFFORT_OFF = "off";
export const EFFORT_LABELS: Record<string, string> = { off: "off", low: "low", high: "high" };

/** A command is only a command while it's the entire composer content and
 * still on one line — `/tmp/foo` inside a sentence, or a second line of
 * prose, is just text the agent should receive verbatim. */
const COMMAND_RE = /^\/([a-z]*)(?:([ \t]+)([^\n]*))?$/;

export interface ParsedCommand {
  /** What was typed after the slash — may be a partial command name. */
  name: string;
  /** The argument text after the first space ("" before one is typed). */
  query: string;
  /** True once a space follows the name: pick an argument, not a command. */
  hasArg: boolean;
}

export const parseCommand = (text: string): ParsedCommand | null => {
  const m = COMMAND_RE.exec(text);
  return m ? { name: m[1], query: m[3] ?? "", hasArg: Boolean(m[2]) } : null;
};

/** Substring match, prefix hits first, original order preserved within each
 * group — deliberately not fuzzy scoring: with a handful of local models a
 * plain "contains" never surprises anyone, and there's nothing to tune. */
export const filterOptions = <T extends CommandOption>(options: T[], query: string): T[] => {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const hit = (o: T) => `${o.value} ${o.label}`.toLowerCase();
  return [
    ...options.filter((o) => hit(o).startsWith(q)),
    ...options.filter((o) => !hit(o).startsWith(q) && hit(o).includes(q)),
  ];
};

/** Which command a partially-typed name resolves to, if any — exact match
 * wins, otherwise a unique prefix ("/mo" ⇒ model) so the common case is two
 * keystrokes. Ambiguous or unknown ⇒ null (the palette stays in
 * pick-a-command mode). */
export const resolveCommand = (name: string): CommandSpec | null => {
  const exact = COMMANDS.find((c) => c.name === name);
  if (exact) return exact;
  const prefixed = COMMANDS.filter((c) => c.name.startsWith(name));
  return name && prefixed.length === 1 ? prefixed[0] : null;
};
