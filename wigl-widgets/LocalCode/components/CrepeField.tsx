// Thin controlled-React wrapper around Milkdown's Crepe editor — same shape
// as the CodeMirrorField it replaced: create the editor once, sync external
// `value` changes in, forward user edits out via Crepe's markdown listener.
// Crepe is vanilla (no React dep of its own), so it mounts into a plain ref'd
// div and everything below is imperative bridging.
//
// The editor libraries are loaded with dynamic `import()` inside the mount
// effect, NOT static top-level imports: Milkdown's Vue/ProseMirror components
// touch `document` at module-evaluation time, which crashes `plugin:check`'s
// headless render (no DOM). Deferring the import to the effect — which only
// runs in a real browser realm — keeps the module import-safe while still
// bundling everything into the one plugin file.
//
// Feature surface is stripped to a chat composer, not a document editor: only
// list-item and placeholder are added (see the mount effect for why cursor is
// off and heading formatting is removed). The required stylesheet is
// `composer.css` (imported by Composer.tsx), written against wigl's own theme
// tokens; Crepe's shipped color themes are never imported.
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

export type CrepeHandle = {
  /** Move focus into the editor and drop the caret at the very end. */
  focusEnd: () => void;
};

// What the mount effect resolves and the other effects/handle read back.
type Loaded = {
  editor: { action: (fn: (ctx: unknown) => void) => void };
  replaceAll: (markdown: string) => (ctx: unknown) => void;
  focusEnd: () => void;
};

export const CrepeField = ({
  value,
  onChange,
  placeholder,
  handleRef,
  onKeyDownCapture,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  handleRef?: Ref<CrepeHandle>;
  // Capture-phase keydown — runs before ProseMirror's own handlers, so the
  // slash palette (and Mod/Alt-Enter send) can win by calling
  // preventDefault + stopPropagation. See Composer.tsx.
  onKeyDownCapture?: (e: React.KeyboardEvent) => void;
  className?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Latest markdown Crepe emitted — lets the value-sync effect below skip
  // the echo of the user's own typing (doc already matches `value`).
  const lastEmittedRef = useRef(value);
  // `value` at mount time, read inside the async effect without making it a dep.
  const initialValueRef = useRef(value);
  const placeholderRef = useRef(placeholder);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    let destroy: (() => void) | undefined;

    (async () => {
      // CrepeBuilder, not the `Crepe` umbrella — the umbrella statically
      // imports every feature (katex, @codemirror/language-data, codemirror
      // basicSetup, dompurify, …) whether enabled or not, ballooning this
      // repo's non-tree-shaking single-file bundle to ~17MB. The builder pulls
      // only what we addFeature.
      // No `cursor` feature: it layers a `prosemirror-virtual-cursor` (a fake
      // caret element) on top of the native contentEditable caret, which shows
      // as a duplicated/ghost cursor — badly misplaced inside code blocks. The
      // native caret is theme-visible on its own via `caret-color` in
      // composer.css, so the virtual one is pure downside here.
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

      const crepe = new CrepeBuilder({ root: containerRef.current, defaultValue: initialValueRef.current })
        .addFeature(listItem)
        .addFeature(placeholderFeature, { text: placeholderRef.current, mode: "block" });
      crepe.on((api: { markdownUpdated: (fn: (ctx: unknown, md: string) => void) => void }) => {
        api.markdownUpdated((_ctx, markdown) => {
          lastEmittedRef.current = markdown;
          onChangeRef.current(markdown);
        });
      });
      // Kill on-the-fly block formatting that fights a chat prompt: typing
      // `# ` (heading) or ``` (fenced code block) should stay literal text,
      // not silently reshape the editor mid-keystroke — the fence in
      // particular read as "nothing happens, then the closing backticks turn
      // it into a code input" (#10). Remove the input rules (the typed
      // triggers) and their keymaps; the nodes stay in the schema so pasted
      // markdown still round-trips, but nothing auto-formats as you type.
      await crepe.editor.remove([
        commonmark.wrapInHeadingInputRule,
        commonmark.headingKeymap,
        commonmark.createCodeBlockInputRule,
        commonmark.codeBlockKeymap,
      ]);

      loadedRef.current = {
        editor: crepe.editor,
        replaceAll: utils.replaceAll,
        focusEnd: () =>
          crepe.editor.action((ctx: unknown) => {
            const view = (ctx as { get: (s: unknown) => EditorViewLike }).get(core.editorViewCtx);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-way sync for programmatic changes (chip clicks, palette apply,
  // submit-clears). User typing already flows out via the listener above, so
  // this is a no-op on every keystroke (value === last emitted).
  useEffect(() => {
    const loaded = loadedRef.current;
    if (!loaded || value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    loaded.editor.action(loaded.replaceAll(value));
  }, [value]);

  useImperativeHandle(handleRef, () => ({
    focusEnd: () => loadedRef.current?.focusEnd(),
  }));

  return <div ref={containerRef} className={className} onKeyDownCapture={onKeyDownCapture} />;
};

// Minimal shape of the ProseMirror EditorView bits focusEnd touches — avoids
// pulling prose types (and their document-touching modules) into the static
// import graph.
type EditorViewLike = {
  state: { tr: { setSelection: (s: unknown) => unknown }; doc: unknown; selection: unknown };
  dispatch: (tr: unknown) => void;
  focus: () => void;
};
