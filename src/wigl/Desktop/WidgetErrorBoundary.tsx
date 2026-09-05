import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { ErrorOverlay } from "../ErrorOverlay";

// All widgets on a monitor share one React root now, so an uncaught render
// throw in one would otherwise take down every widget on that screen.
export class WidgetErrorBoundary extends Component<{ id: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[wigl] widget "${this.props.id}" crashed`, error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      // Render the crash through the shared ErrorOverlay inside a widget-
      // shaped card, so an uncaught throw (a missing permission, a first-
      // render bug) reads as "this one widget is broken" contained in its
      // own tile — not raw red text floating on the desktop.
      return (
        <div className="dark flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card/95 font-mono text-card-foreground">
          <ErrorOverlay kind="unknown" title={`"${this.props.id}" crashed`} message={this.state.error.message} />
        </div>
      );
    }
    return this.props.children;
  }
}
