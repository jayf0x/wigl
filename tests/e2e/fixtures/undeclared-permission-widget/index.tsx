// Uses a *gated* host export (`useStorage` needs the "storage" permission)
// while its package.json declares no permissions at all. Typechecks and
// builds fine — permissions are a runtime property of the host registry, not
// a type — and is meant to fail at `widget:check`, which renders it through
// the app's real `createPluginRequire`.
//
// This is the shape of a bug that used to reach the owner's screen: the
// widget installs, the app launches clean, and the only symptom is a widget
// that isn't there. `useStorage` is called during render (not in an effect)
// specifically so a `renderToString` probe reaches it.
import { Widget } from "@/wigl";
import { useStorage } from "@/wigl/hooks";

const UndeclaredPermissionWidget = () => {
  const [value] = useStorage("e2e_undeclared", "unset");
  return (
    <Widget w={2} h={2}>
      <span>{String(value)}</span>
    </Widget>
  );
};

export default UndeclaredPermissionWidget;
