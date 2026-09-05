// opencode's own permission-ask protocol, rendered 1:1 (see AGENTS.md's
// "access model") — three replies, no wigl-invented approval flow. Styled off
// theme tokens only; the old amber literal was a hardcoded color, which
// docs/theming.md bans outright.
import { Ban, Check, CheckCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/wigl/utils";
import type { PermissionRequest } from "../types";

const Action = ({
  icon: Icon,
  title,
  danger,
  onClick,
}: {
  icon: typeof Check;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="icon-xs"
    data-no-drag
    title={title}
    onClick={onClick}
    className={cn("rounded-md text-muted-foreground", danger ? "hover:text-destructive" : "hover:text-foreground")}
  >
    <Icon className="size-3.5" />
  </Button>
);

export const PermissionBar = ({
  requests,
  onReply,
}: {
  requests: PermissionRequest[];
  onReply: (requestID: string, reply: "once" | "always" | "reject") => void;
}) => {
  if (requests.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col border-primary/30 border-b bg-primary/5">
      {requests.map((req) => (
        <div key={req.id} className="flex items-center gap-2 px-4 py-1.5 text-[11px]">
          <ShieldAlert className="size-3.5 shrink-0 text-primary" />
          <span className="flex-1 truncate text-foreground/80">
            {req.permission}
            {req.patterns.length > 0 ? ` — ${req.patterns.join(", ")}` : ""}
          </span>
          <Action icon={Check} title="allow once" onClick={() => onReply(req.id, "once")} />
          <Action icon={CheckCheck} title="always allow" onClick={() => onReply(req.id, "always")} />
          <Action icon={Ban} title="reject" danger onClick={() => onReply(req.id, "reject")} />
        </div>
      ))}
    </div>
  );
};
