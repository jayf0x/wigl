import { type SettingSection, useStorage } from "@/wigl/hooks";
import { Switch } from "@/components/ui/switch";

// POC for a widget-contributed Settings section (see docs/widgets.md): a
// sibling settingsSection.tsx default-exports a SettingSection, built and
// loaded alongside index.tsx but independently of it — the loader registers this
// regardless of whether the widget itself is currently mounted, so the
// section stays in the Settings modal even while the widget is
// hidden/closed. Deliberately trivial — proves export → show up in
// Settings, searchable → toggle reflected live in the widget's own
// rendering, nothing more.
const TodoSettingsSection = () => {
  const [highlight, setHighlight] = useStorage("todo:highlightBg", false);
  return (
    <label className="flex items-center justify-between gap-3 px-1 py-1">
      <span className="text-sm">Highlight background</span>
      <Switch checked={highlight} onCheckedChange={setHighlight} />
    </label>
  );
};

const settingsSection: SettingSection = {
  id: "todo",
  label: "Todo",
  fields: [{ id: "todo-highlight", label: "Highlight background", keywords: ["red", "color"] }],
  render: () => <TodoSettingsSection />,
};

export default settingsSection;
