// Minimal valid widget — the "everything should work" control case for the
// widgets-root e2e suite. Deliberately has no data hook, no config, no host
// modules beyond `@/wigl` itself, so a failure anywhere in the pipeline
// (typecheck, build, check, install) can only be the pipeline's fault, not
// this fixture's.
import { Widget } from "@/wigl";

const GoodWidget = () => (
  <Widget w={2} h={2}>
    <span>e2e good widget</span>
  </Widget>
);

export default GoodWidget;
