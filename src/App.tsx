import { ReposWidget } from "./ReposWidget";
import "./App.css";

// This app renders exactly one widget at a time — swap the import/return
// here to mount a different one. See docs/widgets.md before adding another.
function App() {
  return <ReposWidget />;
}

export default App;
