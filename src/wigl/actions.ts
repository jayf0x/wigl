// Global desktop actions, shown in the right-click menu on any widget
// (Desktop.tsx renders the menu and supplies the ctx). Adding an action is
// one entry here — no menu or Desktop changes needed.

export interface DesktopActionCtx {
  /** Move every widget back to monitor 0, auto-placed with zero overlap,
   * and persist the result. */
  resetLayout(): void;
}

export interface DesktopAction {
  id: string;
  label: string;
  run(ctx: DesktopActionCtx): void;
}

export const DESKTOP_ACTIONS: DesktopAction[] = [
  { id: "reset-layout", label: "Reset layout", run: (ctx) => ctx.resetLayout() },
];
