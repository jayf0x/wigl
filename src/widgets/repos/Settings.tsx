import { useState } from "react";
import { Check, Loader2, Settings2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveSourceDir, sourceDirExists } from "./commands";

// Plain absolute-positioned panel, not a popover/dialog primitive — same
// "just a div" pattern Row.tsx already uses for its inline commit-message
// box. The gear button toggles it; there's exactly one field today (source
// dir), so a full form component would be pure ceremony.
export function Settings({ sourceDir, onSave }: { sourceDir: string; onSave: (dir: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(sourceDir);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  async function submit() {
    if (checking) return;
    const resolved = await resolveSourceDir(value);
    if (!resolved) return;
    setChecking(true);
    setError(null);
    const exists = await sourceDirExists(resolved);
    setChecking(false);
    if (!exists) {
      setError("folder doesn't exist");
      return;
    }
    if (resolved !== sourceDir) onSave(resolved);
    close();
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-xs"
        title="settings"
        onClick={() => {
          setValue(sourceDir);
          setError(null);
          setOpen((v) => !v);
        }}
        className={cn("opacity-50 hover:opacity-90", open && "opacity-90")}
      >
        <Settings2 className="size-3" />
      </Button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-64 rounded border border-white/10 bg-neutral-900 p-2 shadow-lg">
          <label className="mb-1 block text-[10px] tracking-wide opacity-50">source directory</label>
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") close();
              }}
              placeholder="~/Documents/GitHub"
              className={cn(
                "min-w-0 flex-1 rounded border bg-neutral-950 px-1.5 py-1 text-[11px] outline-none",
                error ? "border-red-400/50" : "border-white/10",
              )}
            />
            <Button variant="ghost" size="icon-xs" title="cancel" onClick={close}>
              <X className="size-3" />
            </Button>
            <Button variant="ghost" size="icon-xs" title="save" disabled={checking} onClick={submit}>
              {checking ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-cyan-400" />}
            </Button>
          </div>
          {error && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-red-400/80">
              <TriangleAlert className="size-3 shrink-0" />
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
