// usePty — spawns a real PTY-backed process on mount (backed by the vendored
// Rust commands in src-tauri/src/pty.rs) and streams its output. Gated
// behind the "pty" permission in plugins/registry.ts: interactive terminal
// sessions are the one thing tauri-plugin-shell's execute/spawn genuinely
// can't do (no tty semantics, no stdin write path), so this is the one host
// module backed by app-specific Rust rather than a shell-out. See
// docs/widgets.md's host module section for the pattern this follows.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface PtyOptions {
  cols: number;
  rows: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PtyExit {
  exitCode: number;
}

export interface UsePtyResult {
  ready: boolean;
  exit: PtyExit | null;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

/**
 * Spawns `file args` in a real pseudo-terminal on mount, killed on unmount.
 * `onData` fires for every chunk of raw output (write straight into an
 * xterm.js `Terminal` — it already speaks ANSI). `onData` is ref'd
 * internally, so callers don't need to memoize it.
 *
 *   const pty = usePty("/bin/zsh", [], { cols: 80, rows: 24 }, (chunk) => term.write(chunk));
 */
export const usePty = (
  file: string,
  args: string[],
  options: PtyOptions,
  onData: (chunk: Uint8Array) => void,
): UsePtyResult => {
  const [ready, setReady] = useState(false);
  const [exit, setExit] = useState<PtyExit | null>(null);
  const idRef = useRef<number | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setExit(null);

    const readLoop = async (id: number) => {
      for (;;) {
        try {
          const chunk = await invoke<ArrayBuffer>("pty_read", { id });
          if (cancelled) return;
          onDataRef.current(new Uint8Array(chunk));
        } catch (e) {
          if (!(typeof e === "string" && e.includes("EOF"))) {
            console.error("[wigl] usePty read failed", e);
          }
          return;
        }
      }
    };

    (async () => {
      let id: number;
      try {
        id = await invoke<number>("pty_spawn", {
          file,
          args,
          cols: options.cols,
          rows: options.rows,
          cwd: options.cwd ?? null,
          env: options.env ?? {},
        });
      } catch (e) {
        console.error("[wigl] usePty spawn failed", e);
        return;
      }
      if (cancelled) {
        invoke("pty_kill", { id }).catch(() => {});
        return;
      }
      idRef.current = id;
      setReady(true);
      readLoop(id);
      try {
        const exitCode = await invoke<number>("pty_exitstatus", { id });
        if (!cancelled) setExit({ exitCode });
      } catch {
        // killed before it exited on its own — nothing to surface
      }
    })();

    return () => {
      cancelled = true;
      if (idRef.current !== null) invoke("pty_kill", { id: idRef.current }).catch(() => {});
      idRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options/args compared by shape, not identity, so spawning stays a one-shot per mount rather than re-keying on every render
  }, [file, JSON.stringify(args), options.cols, options.rows, options.cwd, JSON.stringify(options.env)]);

  const write = (data: string) => {
    if (idRef.current !== null) invoke("pty_write", { id: idRef.current, data }).catch(console.error);
  };
  const resize = (cols: number, rows: number) => {
    if (idRef.current !== null) invoke("pty_resize", { id: idRef.current, cols, rows }).catch(console.error);
  };
  const kill = () => {
    if (idRef.current !== null) invoke("pty_kill", { id: idRef.current }).catch(console.error);
  };

  return { ready, exit, write, resize, kill };
};
