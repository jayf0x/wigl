// Renders opencode's own permission-ask protocol directly (see AGENTS.md —
// "access model") rather than a wigl-invented approval flow: one row per
// pending `PermissionRequest`, three buttons mapping 1:1 to opencode's
// `reply` values (`once` / `always` / `reject`).
import { Ban, Check, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PermissionRequest } from "../types";

export const PermissionBar = ({
  requests,
  onReply,
}: {
  requests: PermissionRequest[];
  onReply: (requestID: string, reply: "once" | "always" | "reject") => void;
}) => {
  if (requests.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-border/60 border-b bg-amber-500/5 px-2 py-1.5">
      {requests.map((req) => (
        <div key={req.id} className="flex items-center gap-2 text-[10.5px]">
          <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
          <span className="flex-1 truncate opacity-80">
            {req.permission}
            {req.patterns.length > 0 ? ` — ${req.patterns.join(", ")}` : ""}
          </span>
          <Button size="icon-xs" variant="ghost" title="allow once" onClick={() => onReply(req.id, "once")}>
            <Check className="size-3" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="always allow"
            onClick={() => onReply(req.id, "always")}
            className="text-primary"
          >
            <Check className="size-3" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="reject"
            onClick={() => onReply(req.id, "reject")}
            className="text-destructive"
          >
            <Ban className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
};
