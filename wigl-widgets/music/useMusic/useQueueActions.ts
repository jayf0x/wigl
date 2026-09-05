// Up-next queue edits (remove / reorder). Small and self-contained: only
// needs `cmd`/`markPending` (from useConnection) and the shared
// `optimisticRef`/`setUpNext` to hold the optimistic list until the
// `queue_items_updated` reconcile.
import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { arrayMove } from "../util";
import type { QueueItem } from "../types";
import type { OptimisticState } from "./types";

export const useQueueActions = ({
  cmd,
  markPending,
  optimisticRef,
  setUpNext,
}: {
  cmd: (command: string, args?: Record<string, unknown>) => void;
  markPending: (action: string) => void;
  optimisticRef: MutableRefObject<OptimisticState>;
  setUpNext: Dispatch<SetStateAction<QueueItem[]>>;
}) => {
  /** Any queue edit (remove / reorder) — hold the optimistic `upNext` until the
   * `queue_items_updated` reconcile so it doesn't flicker back mid-command. */
  const holdQueueEdit = useCallback(() => {
    optimisticRef.current.holdQueue = true;
    markPending("queueEdit");
  }, [optimisticRef, markPending]);

  const removeFromQueue = useCallback(
    (queueItemId: string) => {
      setUpNext((list) => list.filter((i) => i.queue_item_id !== queueItemId));
      holdQueueEdit();
      cmd("player_queues/delete_item", { item_id_or_index: queueItemId });
    },
    [cmd, holdQueueEdit, setUpNext],
  );

  const moveQueueItem = useCallback(
    (queueItemId: string, posShift: number) => {
      if (!posShift) return;
      setUpNext((list) =>
        arrayMove(
          list,
          list.findIndex((i) => i.queue_item_id === queueItemId),
          posShift,
        ),
      );
      holdQueueEdit();
      cmd("player_queues/move_item", { queue_item_id: queueItemId, pos_shift: posShift });
    },
    [cmd, holdQueueEdit, setUpNext],
  );

  const moveQueueItemToEnd = useCallback(
    (queueItemId: string) => {
      setUpNext((list) => {
        const from = list.findIndex((i) => i.queue_item_id === queueItemId);
        if (from < 0 || from === list.length - 1) return list;
        const copy = [...list];
        const [it] = copy.splice(from, 1);
        copy.push(it);
        return copy;
      });
      holdQueueEdit();
      cmd("player_queues/move_item_end", { queue_item_id: queueItemId });
    },
    [cmd, holdQueueEdit, setUpNext],
  );

  return { removeFromQueue, moveQueueItem, moveQueueItemToEnd };
};
