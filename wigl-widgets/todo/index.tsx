import { Widget } from "@/wigl";
import { useStorage } from "@/wigl/hooks";

// No gridConfig export — the desktop's defaults (3×4 cells, first open slot)
// fit. Placeholder: no useTodoWidget hook / todoWidget.config.ts
// yet — add them alongside this file, mirroring wigl-widgets/repos, once
// storage is real.
const TodoWidget = () => {
  const [highlight] = useStorage("todo:highlightBg", false);

  return (
    <Widget
      headerContent={
        <span className="px-1 text-[10px] tracking-widest opacity-40">TODO</span>
      }
    >
      <div
        className="flex-1 overflow-y-auto px-3 py-2 text-[11px] opacity-40"
        style={highlight ? { background: "#dc2626" } : undefined}
      >
        no todos yet
      </div>
    </Widget>
  );
};

export default TodoWidget;
