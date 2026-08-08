// A thin controlled-React wrapper around bare `@codemirror/view` — not
// `@uiw/react-codemirror`, whose `getDefaultExtensions.js` unconditionally
// imports its light/dark themes and full `basicSetup` bundle at module load
// regardless of the `theme`/`basicSetup` props passed to it. Since this
// plugin's build has no minifier/tree-shaking pass to drop that dead code
// (`scripts/plugin.ts`'s `minify: false`), pulling the wrapper in ballooned
// the built bundle to ~4.4MB for what's otherwise a few hundred KB of
// CodeMirror core + markdown language support. This file is the entire
// wrapper: create the view once, sync external `value` changes in, forward
// user edits out via an update listener.
import { useEffect, useRef } from "react";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const CodeMirrorField = ({
  value,
  onChange,
  extensions,
  onCreateEditor,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  extensions: Extension[];
  onCreateEditor?: (view: EditorView) => void;
  className?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // `extensions` is built once by the caller (a `useMemo(..., [])`, same
  // contract @uiw/react-codemirror itself expects) — deliberately not a
  // dependency here, so the view (and its undo history/selection) is
  // created exactly once for the component's lifetime.
  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          ...extensions,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    onCreateEditor?.(view);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-way sync for programmatic changes (slash-command chip clicks,
  // palette apply, submit-clears-text) — user typing already flows the
  // other direction via the update listener above, so this is a no-op on
  // every keystroke (doc already matches `value`).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={containerRef} className={className} />;
};
