// The shared WYSIWYG markdown editor — Milkdown's Crepe behind a controlled
// React wrapper. It lives in the host (not in each widget's bundle) so the
// ~5MB of ProseMirror/Vue loads once and only when a widget actually mounts
// an editor: the libs are dynamic `import()`s inside the mount effect, so
// they stay in their own lazy chunk otherwise. Widgets never import
// `@milkdown/*` themselves (it isn't a host module) — they get the editor
// through `@/wigl`.
//
// Why dynamic imports and not top-level ones: Milkdown's Vue/ProseMirror
// modules touch `document` at evaluation time, which would crash
// `widget:check`'s headless render (no DOM). The effect only runs in a real
// browser realm.
//
// CrepeBuilder, not the `Crepe` umbrella: the umbrella statically pulls every
// feature (katex, codemirror language-data, dompurify, …) whether enabled or
// not. The builder pulls only what's added — here `list-item` + `placeholder`.
// The `cursor` feature stays off: it layers a fake caret on the native one and
// ghosts a duplicate, worst inside code blocks; `caret-color` in the
// stylesheet keeps the native caret visible instead.
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
// Type-only: erased at compile time, so the document-touching runtime modules
// stay out of the static import graph.
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";
import { cn } from "../utils";
import "./markdown-editor.css";

export type MarkdownEditorHandle = {
  /** Move focus into the editor and drop the caret at the very end. */
  focusEnd: () => void;
};

type Loaded = {
  editor: { action: (fn: (ctx: Ctx) => void) => void };
  replaceAll: (markdown: string) => (ctx: Ctx) => void;
  focusEnd: () => void;
};

export const MarkdownEditor = ({
  value,
  onChange,
  placeholder = "start writing…",
  formatOnType = true,
  handleRef,
  onKeyDownCapture,
  className,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** `false` keeps `# ` and ``` as literal text instead of reshaping the
   * editor mid-keystroke (a chat prompt, not a document). Read once at mount. */
  formatOnType?: boolean;
  handleRef?: Ref<MarkdownEditorHandle>;
  /** Capture phase — runs before ProseMirror's own handlers, so a caller can
   * claim a chord (e.g. ⌘Enter to send) with preventDefault + stopPropagation. */
  onKeyDownCapture?: (e: React.KeyboardEvent) => void;
  /** Layout knobs are CSS vars, not props: `--md-padding` (default
   * `14px 18px 40px`) and `--md-max-height` (default none, else the editor
   * scrolls). Set them from here, e.g. `[--md-padding:10px_12px]`. */
  className?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Latest markdown Crepe emitted — lets the value-sync effect skip the echo
  // of the user's own typing.
  const lastEmittedRef = useRef(value);
  // Mount-time inputs, read inside the async effect without becoming deps.
  const initial = useRef({ value, placeholder, formatOnType });

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    let destroy: (() => void) | undefined;

    (async () => {
      const [{ CrepeBuilder }, { listItem }, { placeholder: placeholderFeature }, commonmark, core, state, utils] =
        await Promise.all([
          import("@milkdown/crepe/builder"),
          import("@milkdown/crepe/feature/list-item"),
          import("@milkdown/crepe/feature/placeholder"),
          import("@milkdown/kit/preset/commonmark"),
          import("@milkdown/kit/core"),
          import("@milkdown/kit/prose/state"),
          import("@milkdown/kit/utils"),
        ]);
      if (destroyed || !containerRef.current) return;

      const { value: v, placeholder: text, formatOnType: format } = initial.current;
      const crepe = new CrepeBuilder({ root: containerRef.current, defaultValue: v })
        .addFeature(listItem)
        // "doc": show the placeholder only when the whole field is empty —
        // "block" re-shows it on every empty line, which reads as "my text
        // disappeared".
        .addFeature(placeholderFeature, { text, mode: "doc" });
      crepe.on((api: { markdownUpdated: (fn: (ctx: unknown, md: string) => void) => void }) => {
        api.markdownUpdated((_ctx, markdown) => {
          lastEmittedRef.current = markdown;
          onChangeRef.current(markdown);
        });
      });
      // Remove the typed triggers (input rules + keymaps) for headings and
      // fenced code; the nodes stay in the schema so pasted markdown still
      // round-trips.
      if (!format)
        await crepe.editor.remove([
          commonmark.wrapInHeadingInputRule,
          ...commonmark.headingKeymap,
          commonmark.createCodeBlockInputRule,
          ...commonmark.codeBlockKeymap,
        ]);

      loadedRef.current = {
        editor: crepe.editor,
        replaceAll: utils.replaceAll,
        focusEnd: () =>
          crepe.editor.action((ctx: Ctx) => {
            const view = ctx.get(core.editorViewCtx) as EditorViewLike;
            view.dispatch(view.state.tr.setSelection(state.Selection.atEnd(view.state.doc)));
            view.focus();
          }),
      };
      await crepe.create();
      destroy = () => crepe.destroy();
      if (destroyed) destroy();
    })();

    return () => {
      destroyed = true;
      destroy?.();
      loadedRef.current = null;
    };
  }, []);

  // One-way sync for programmatic changes (a chat composer clearing on send).
  // A no-op on every keystroke (value === last emitted).
  useEffect(() => {
    const loaded = loadedRef.current;
    if (!loaded || value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    loaded.editor.action(loaded.replaceAll(value));
  }, [value]);

  useImperativeHandle(handleRef, () => ({ focusEnd: () => loadedRef.current?.focusEnd() }));

  return <div ref={containerRef} className={cn("wigl-md", className)} onKeyDownCapture={onKeyDownCapture} />;
};

// Minimal shape of the ProseMirror EditorView bits focusEnd touches — keeps
// prose types (and their document-touching modules) out of the static graph.
type EditorViewLike = {
  state: { tr: { setSelection: (s: unknown) => unknown }; doc: Node; selection: unknown };
  dispatch: (tr: unknown) => void;
  focus: () => void;
};
