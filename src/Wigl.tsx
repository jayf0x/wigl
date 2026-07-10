import { ProjectStatus, revealInFinder, useWigl } from "./useWigl";
import { onDragHandleMouseDown } from "./drag";

const BADGE: Record<ProjectStatus["status"], string> = {
  unreleased: "🟢",
  clean: "⚪",
  error: "⚠️",
};

function relTime(epochSeconds: number) {
  if (!epochSeconds) return "?";
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

export function Wigl() {
  const { projects, loading, refresh } = useWigl();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black/80 font-mono text-white/85 backdrop-blur-xl">
      <div
        onMouseDown={onDragHandleMouseDown}
        className="flex cursor-grab items-center justify-between border-b border-white/10 px-3 py-2 active:cursor-grabbing"
      >
        <span className="text-[10px] tracking-widest opacity-40">WIGL</span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={refresh}
          title="refresh"
          className="text-[11px] opacity-50 hover:opacity-90"
        >
          {loading ? "…" : "🔄"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!loading && projects.length === 0 && (
          <div className="px-3 py-2 text-[11px] opacity-40">no projects found</div>
        )}
        {projects.map((p) => (
          <div
            key={p.name}
            onClick={() => revealInFinder(p.path)}
            title={p.error ?? p.status}
            className="flex cursor-pointer items-center justify-between gap-2 border-b border-white/5 px-3 py-1.5 hover:bg-white/5 last:border-none"
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px]">
              {p.name}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] opacity-35">{relTime(p.lastCommit)}</span>
              <span className="text-[9px] leading-none">{BADGE[p.status]}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
