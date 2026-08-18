import { Widget } from "@/wigl";
import { useRegisterSettings, useStorage } from "@/wigl/hooks";
import { Switch } from "@/components/ui/switch";

// POC for useRegisterSettings (see docs/widgets.md): a widget can contribute
// its own section to the general Settings modal, opt-in, backed by the same
// useStorage a widget would use for any other live state. Deliberately
// trivial — proves register → show up in Settings, searchable → toggle
// reflected live in the widget's own rendering, nothing more.
const TodoSettingsSection = () => {
  const [highlight, setHighlight] = useStorage("todo:highlightBg", false);
  return (
    <label className="flex items-center justify-between gap-3 px-1 py-1">
      <span className="text-sm">Highlight background</span>
      <Switch checked={highlight} onCheckedChange={setHighlight} />
    </label>
  );
};

// Static — a fresh object every render would re-fire useRegisterSettings's
// effect (register/unregister) on every TodoWidget render for no reason.
const TODO_SETTINGS_SECTION = {
  id: "todo",
  label: "Todo",
  fields: [{ id: "todo-highlight", label: "Highlight background", keywords: ["red", "color"] }],
  render: () => <TodoSettingsSection />,
};

// No gridConfig export — the desktop's defaults (3×4 cells, first open slot)
// fit. Placeholder: no useTodoWidget hook / todoWidget.config.ts
// yet — add them alongside this file, mirroring wigl-widgets/repos, once
// storage is real.
const TodoWidget = () => {
  const [highlight] = useStorage("todo:highlightBg", false);
  useRegisterSettings(TODO_SETTINGS_SECTION);

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
