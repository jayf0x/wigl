// Deliberately fails `tsc -p <root> --noEmit` (w expects a number) while
// still passing `widget:build` — Bun.build only transpiles, it never
// typechecks, so this fixture proves the two checks catch different things
// and both matter (see docs/widgets.md's "Typechecking" section).
import { Widget } from "@/wigl";

const BrokenTypecheckWidget = () => (
  // Deliberate: w must be a number. Left unsuppressed on purpose — this
  // fixture's entire job is to make `tsc -p <root> --noEmit` fail.
  <Widget w="three" h={2}>
    <span>e2e broken-typecheck widget</span>
  </Widget>
);

export default BrokenTypecheckWidget;
