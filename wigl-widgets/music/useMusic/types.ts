// Cross-hook types shared by useMusic's composing shell and its sibling
// hooks — split out so a hook file can import just the shape it needs
// without reaching into the shell for it.
import type { RepeatMode } from "../types";

export type PlayOption = "play" | "replace" | "next" | "add";
export type QueueMode = "append" | "replace";

/** P1.1 — fields the UI has already predicted. `refreshQueue` (useConnection)
 * keeps each prediction until the server's own snapshot agrees, then clears
 * the matching `pending` entry via `pendingClear`. Written by useConnection's
 * `refreshQueue`/`markPending` and by the transport/queue actions that
 * predict a change ahead of the server confirming it. */
export interface OptimisticState {
  playing?: boolean;
  repeat?: RepeatMode;
  shuffle?: boolean;
  /** queue_item_id or media uri we expect to become the current item */
  expectId?: string;
  /** next / previous / row-play in flight — hold now/currentItem/upNext */
  holdNow?: boolean;
  /** queue add/remove/reorder in flight — hold upNext */
  holdQueue?: boolean;
  /** hard cap on any hold, in case the confirming event never matches */
  holdUntil?: number;
}
