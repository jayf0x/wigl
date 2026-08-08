// CodeMirror wiring for the composer, split out of Composer.tsx so the
// component stays about layout/state and this stays about editor mechanics.
// Chosen over Milkdown/MDXEditor (see AGENTS.md's UI shape section) because
// it injects its own styles from JS — the plugin bundler has no CSS
// pipeline (`scripts/plugin.ts` emits one JS blob), so any editor that
// ships a required stylesheet silently loses its theme. CodeMirror's
// `EditorView.theme()`/`HighlightStyle` are JS objects the view turns into
// a `<style>` tag itself; nothing to bundle, nothing to inject by hand.
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
// Not `codeLanguages: languages` from @codemirror/language-data — that
// package's per-language grammars are meant to be dynamically imported, but
// `scripts/plugin.ts`'s Bun.build emits one non-splittable file, so every
// language (Python, Rust, SQL, ...) would get eagerly inlined: ~9MB for a
// composer that mostly holds prose. Fenced code in a prompt renders as plain
// monospace instead of being syntax-highlighted per language — a fine trade
// for a chat box, not a code editor.
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Markdown syntax gets a light accent, never a hardcoded color — every value
// here is a `var(--token)` from src/wigl/theme (docs/theming.md's hard rule
// applies to CSS-in-JS the same as it does to Tailwind classes).
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--foreground)", fontWeight: 600 },
  { tag: tags.strong, color: "var(--foreground)", fontWeight: 700 },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--primary)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--muted-foreground)" },
  { tag: tags.monospace, color: "var(--accent-foreground)", backgroundColor: "var(--accent)" },
  { tag: tags.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--primary)" },
  { tag: tags.processingInstruction, color: "var(--muted-foreground)" }, // '#', '-', '```' markers
  { tag: tags.meta, color: "var(--muted-foreground)" },
]);

// A chat box, not a document editor — dropped: gutter, folding, active-line
// highlight, bracket matching, search panel. Kept: history (undo/redo) and
// close-brackets-free typing, since prompts are prose, not code.
const chatTheme = EditorView.theme({
  "&": {
    fontSize: "12.5px",
    color: "var(--foreground)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    padding: "10px 12px 4px 12px",
    lineHeight: "1.625",
    caretColor: "var(--foreground)",
    fontFamily: "inherit",
  },
  // The blinking cursor is a synthetic `.cm-cursor` div (from `drawSelection()`
  // above), not the native caret — `caretColor` above has no effect on it.
  // CodeMirror's own baseTheme hardcodes it to black (`&dark .cm-cursor` only
  // switches to a lighter gray when the view is flagged `dark: true`, which
  // wigl's theme — CSS vars picked at runtime, not a fixed light/dark split —
  // never does). Left unset, it's invisible on any dark wigl theme.
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-line": { padding: 0 },
  // Grow with the content, then scroll — a ceiling of ~9 lines at this font
  // size, matching the old textarea's 200px cap.
  ".cm-scroller": { fontFamily: "inherit", maxHeight: "200px", overflowY: "auto" },
  ".cm-placeholder": { color: "color-mix(in oklab, var(--muted-foreground) 60%, transparent)" },
  "&.cm-editor": { backgroundColor: "transparent" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--ring) 30%, transparent) !important",
  },
});

/** Enter continues a `-`/`*`/`+`/`1.` list line with the same marker, or (on
 * an already-empty item) clears it to exit the list — the one piece of
 * "feels like a real list editor" behavior a plain textarea can't offer.
 * Falls through (returns false) for every other line so normal newline
 * insertion still applies. */
const continueList = (view: EditorView): boolean => {
  const { state } = view;
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const match = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(line.text);
  if (!match) return false;
  const [, indent, marker, gap] = match;
  const markerEnd = indent.length + marker.length + gap.length;
  const isEmpty = line.text.slice(markerEnd).trim() === "";
  if (isEmpty) {
    view.dispatch({
      changes: { from: line.from, to: line.to },
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    return true;
  }
  const nextMarker = /^\d+[.)]$/.test(marker) ? `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker;
  const insert = `\n${indent}${nextMarker}${gap}`;
  view.dispatch({
    changes: { from: head, insert },
    selection: { anchor: head + insert.length },
    scrollIntoView: true,
  });
  return true;
};

/** Palette-open keys (nav + Enter-applies + Escape-clears) always win —
 * `Prec.highest` so they run before CodeMirror's own Enter/Tab bindings.
 * `isOpen`/callbacks read through refs so this extension can be built once
 * (`useMemo(() => [...], [])`) instead of being torn down and rebuilt, and
 * thus losing selection/history, on every keystroke. */
export const paletteKeymap = (refs: {
  isOpen: () => boolean;
  moveDown: () => void;
  moveUp: () => void;
  apply: () => void;
  clear: () => void;
}) =>
  Prec.highest(
    keymap.of([
      {
        key: "ArrowDown",
        run: () => (refs.isOpen() ? (refs.moveDown(), true) : false),
      },
      {
        key: "ArrowUp",
        run: () => (refs.isOpen() ? (refs.moveUp(), true) : false),
      },
      {
        key: "Tab",
        run: () => (refs.isOpen() ? (refs.moveDown(), true) : false),
        shift: () => (refs.isOpen() ? (refs.moveUp(), true) : false),
      },
      {
        key: "Enter",
        run: () => (refs.isOpen() ? (refs.apply(), true) : false),
      },
      {
        key: "Escape",
        run: () => (refs.isOpen() ? (refs.clear(), true) : false),
      },
    ]),
  );

/** ⌘/Ctrl/⌥+Enter sends — the one binding this widget deliberately keeps
 * off plain Enter (AGENTS.md: "Enter is a newline... don't 'fix' this back"). */
export const submitKeymap = (onSubmit: () => void) =>
  Prec.highest(
    keymap.of([
      { key: "Mod-Enter", run: () => (onSubmit(), true) },
      { key: "Alt-Enter", run: () => (onSubmit(), true) },
    ]),
  );

/** `placeholder` lives in its own `Compartment` so it can be swapped (busy
 * state toggles the text between "…" and the idle hint) without tearing
 * down the rest of the extension list — reconfiguring a compartment is a
 * normal dispatch, not a remount. */
export const composerExtensions = (opts: {
  isOpen: () => boolean;
  moveDown: () => void;
  moveUp: () => void;
  apply: () => void;
  clear: () => void;
  onSubmit: () => void;
  placeholder: string;
}) => {
  const placeholderCompartment = new Compartment();
  const extensions = [
    history(),
    drawSelection(),
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(highlightStyle),
    chatTheme,
    EditorView.lineWrapping,
    placeholderCompartment.of(placeholderExt(opts.placeholder)),
    paletteKeymap(opts),
    submitKeymap(opts.onSubmit),
    keymap.of([
      { key: "Tab", run: indentMore },
      { key: "Shift-Tab", run: indentLess },
      { key: "Enter", run: continueList },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorState.tabSize.of(2),
  ];
  return { extensions, placeholderCompartment };
};

export const setPlaceholder = (view: EditorView, compartment: Compartment, text: string) => {
  view.dispatch({ effects: compartment.reconfigure(placeholderExt(text)) });
};
