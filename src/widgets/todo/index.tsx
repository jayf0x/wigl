import { Widget, WidgetHeader } from "@/wigl";

// No gridConfig export — the desktop's defaults (3×4 cells, first open slot)
// fit. Placeholder: no useTodoWidget hook / todoWidget.config.ts
// yet — add them alongside this file, mirroring src/widgets/repos, once
// storage is real.
export default function TodoWidget() {
  return (
    <Widget>
      <WidgetHeader>
        <span className="px-1 text-[10px] tracking-widest opacity-40">TODO</span>
      </WidgetHeader>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-[11px] opacity-40">no todos yet</div>
    </Widget>
  );
}
