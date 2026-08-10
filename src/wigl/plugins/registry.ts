import * as React from "react";
import * as Wigl from "@/wigl";
import * as WiglHooks from "@/wigl/hooks";
import * as WiglUtils from "@/wigl/utils";
import * as LucideReact from "lucide-react";
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as Badge from "@/components/ui/badge";
import * as Button from "@/components/ui/button";
import * as Checkbox from "@/components/ui/checkbox";
import * as Input from "@/components/ui/input";
import * as Popover from "@/components/ui/popover";
import * as Progress from "@/components/ui/progress";
import * as ScrollArea from "@/components/ui/scroll-area";
import * as Select from "@/components/ui/select";
import * as Separator from "@/components/ui/separator";
import * as Slider from "@/components/ui/slider";
import * as Switch from "@/components/ui/switch";
import * as Table from "@/components/ui/table";
import * as Tabs from "@/components/ui/tabs";
import * as Textarea from "@/components/ui/textarea";
import type { HostModuleId } from "./host-modules";
import type { WidgetPermission } from "./types";

// The module registry is the entire plugin/host boundary. A plugin's build
// never bundles anything listed here — `bun run plugin:build` rewrites those
// imports into `__wigl_host.require(...)` calls that land in `hostRequire`
// below (see `scripts/plugin.ts`). Two consequences worth being explicit
// about, because both are the reason this exists rather than "just let the
// bundle import whatever":
//
// 1. There is exactly one React. A plugin that bundled its own copy would
//    get its own hook dispatcher and break the moment it renders inside the
//    host's tree — the classic two-Reacts failure, and it fails confusingly
//    rather than loudly.
// 2. This is the only place a capability can be handed out, so it's the only
//    place one can be withheld. Permission enforcement isn't a separate
//    subsystem to build later; it's a lookup in this table.
//
// Anything a plugin needs that *isn't* here (date-fns, a chart lib, its own
// helpers) it bundles itself at build time. That's the whole node_modules
// story — resolved by the plugin's bundler, on the plugin author's machine,
// never by the app at runtime.

interface HostModule {
  // biome-ignore lint/suspicious/noExplicitAny: a module namespace is deliberately untyped here
  value: Record<string, any>;
  /** Permission required for the whole module. Undeclared = the import throws. */
  gate?: WidgetPermission;
  /** Per-export gates, for modules that mix harmless helpers with real
   * capabilities — `@/wigl/utils` hands out both `cn` (formatting) and
   * `runCmd` (arbitrary shell). Gating the module as a unit would force
   * every plugin that wants `cn` to also ask for shell access. */
  members?: Record<string, WidgetPermission>;
}

// Deliberately absent: `@tauri-apps/*`. Plugins get capabilities through the
// host's own API surface, never a raw IPC handle — a plugin holding
// `plugin-shell` directly would make every permission below decorative,
// since it could just re-implement them. When a plugin genuinely needs
// something no host module covers, the fix is a new host module here, not an
// escape hatch.
// Typed as an exact record over HOST_MODULE_IDS: adding a specifier to that
// list without wiring it up here (or the reverse) fails `bun run typecheck`,
// which is the only reliable guard against the build externalizing something
// the runtime can't actually serve.
const HOST_MODULES: Record<HostModuleId, HostModule> = {
  react: { value: React },
  "react/jsx-runtime": { value: ReactJsxRuntime },
  "react/jsx-dev-runtime": { value: ReactJsxDevRuntime },
  "lucide-react": { value: LucideReact },
  "@/wigl": { value: Wigl },
  "@/wigl/hooks": {
    value: WiglHooks,
    members: { useStorage: "storage", useQuery: "storage" },
  },
  "@/wigl/utils": {
    value: WiglUtils,
    members: {
      runCmd: "command",
      runCmdStreaming: "command",
      runCmdBackground: "command",
      isMacos: "command",
      homeDir: "filesystem",
    },
  },
  "@/components/ui/badge": { value: Badge },
  "@/components/ui/button": { value: Button },
  "@/components/ui/checkbox": { value: Checkbox },
  "@/components/ui/input": { value: Input },
  "@/components/ui/popover": { value: Popover },
  "@/components/ui/progress": { value: Progress },
  "@/components/ui/scroll-area": { value: ScrollArea },
  "@/components/ui/select": { value: Select },
  "@/components/ui/separator": { value: Separator },
  "@/components/ui/slider": { value: Slider },
  "@/components/ui/switch": { value: Switch },
  "@/components/ui/table": { value: Table },
  "@/components/ui/tabs": { value: Tabs },
  "@/components/ui/textarea": { value: Textarea },
};

class PluginPermissionError extends Error {}

/** Replaces a gated export with a thrower rather than omitting it, so the
 * failure names the missing permission at the call site instead of showing
 * up as "x is not a function" somewhere unrelated. */
const denied = (pluginId: string, spec: string, member: string, permission: WidgetPermission) => {
  const fail = () => {
    throw new PluginPermissionError(
      `[wigl] plugin "${pluginId}" used ${member} from "${spec}" without the "${permission}" permission — add it to package.json under "wigl.permissions"`,
    );
  };
  return fail;
};

/** Builds the `require` a single plugin sees. Scoped per plugin (not one
 * global) precisely because the answer depends on that plugin's declared
 * permissions — the same specifier resolves differently for two plugins. */
export const createPluginRequire = (pluginId: string, permissions: WidgetPermission[]) => {
  const granted = new Set(permissions);

  // biome-ignore lint/suspicious/noExplicitAny: returns a module namespace
  return (spec: string): Record<string, any> => {
    const mod = (HOST_MODULES as Record<string, HostModule | undefined>)[spec];
    if (!mod) {
      throw new Error(
        `[wigl] plugin "${pluginId}" imported "${spec}", which the host doesn't provide. Bundle it into the plugin instead, or ask for a host module that covers it.`,
      );
    }
    if (mod.gate && !granted.has(mod.gate)) {
      throw new PluginPermissionError(
        `[wigl] plugin "${pluginId}" imported "${spec}" without the "${mod.gate}" permission — add it to package.json under "wigl.permissions"`,
      );
    }
    if (!mod.members) return mod.value;

    // Copy rather than mutate: HOST_MODULES holds live module namespaces
    // shared with the host's own code, and a namespace object is frozen
    // anyway. Each plugin gets its own view of the same exports.
    const view = { ...mod.value };
    for (const [member, permission] of Object.entries(mod.members)) {
      if (permission && !granted.has(permission) && member in view) {
        view[member] = denied(pluginId, spec, member, permission);
      }
    }
    return view;
  };
};
