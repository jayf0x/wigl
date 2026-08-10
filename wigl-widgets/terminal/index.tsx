import { useEffect, useRef } from "react";
import { Widget } from "@/wigl";
import { usePty, type UsePtyResult } from "@/wigl/hooks";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { defaultShell, INITIAL_COLS, INITIAL_ROWS } from "./config";
import { readTermTheme } from "./theme";

const TerminalWidget = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  const pty = usePty(defaultShell(), [], { cols: INITIAL_COLS, rows: INITIAL_ROWS }, (chunk) =>
    termRef.current?.write(chunk),
  );
  // usePty's write/resize/kill are re-created each render (plain closures,
  // not memoized) — the mount effect below only runs once, so it reads
  // through a ref rather than reopening the terminal on every parent render.
  const ptyRef = useRef<UsePtyResult>(pty);
  ptyRef.current = pty;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      theme: readTermTheme(),
      fontSize: 12,
      fontFamily: "ui-monospace, Menlo, Consolas, monospace",
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    term.onData((data) => ptyRef.current.write(data));

    const resize = () => {
      fit.fit();
      ptyRef.current.resize(term.cols, term.rows);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(el);
    resize();

    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTermTheme();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <Widget
      w={6}
      h={6}
      headerContent={<span className="px-1 text-[10px] tracking-widest opacity-40">TERMINAL</span>}
    >
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden px-1 py-1" />
    </Widget>
  );
};

export default TerminalWidget;
