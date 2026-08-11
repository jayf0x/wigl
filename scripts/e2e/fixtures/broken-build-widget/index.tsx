// Deliberately fails `widget:build` — imports a package that doesn't exist
// anywhere (not in the host module registry, not in node_modules), so
// Bun.build can't resolve it and the build fails loud, the way an author's
// typo'd or forgotten dependency should.
import { Widget } from "@/wigl";
import { totallyMissing } from "wigl-e2e-nonexistent-package";

const BrokenBuildWidget = () => (
  <Widget w={2} h={2}>
    <span>{totallyMissing}</span>
  </Widget>
);

export default BrokenBuildWidget;
