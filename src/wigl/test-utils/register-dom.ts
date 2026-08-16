// Preloaded by every `bun test` run (see bunfig.toml) — gives DOM-level
// tests a real `window`/`document` without a browser or Tauri runtime.
// happy-dom over jsdom: lighter, and it's what Bun's own docs point at for
// this exact setup.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();
