/** The specifiers the host serves to plugins at runtime — the same list the
 * build script marks external (see `scripts/plugin.ts`).
 *
 * This is its own file, holding nothing but strings, so the build script can
 * import it without pulling React and every UI component into a CLI process.
 * `registry.ts` types its table against this array, so a specifier added
 * here without a matching runtime entry (or vice versa) is a typecheck
 * error rather than a "module not provided" crash inside someone's app. */
export const HOST_MODULE_IDS = [
  "react",
  "react/jsx-runtime",
  // The dev runtime is served too, not just the production one. Bun's
  // transpiler emits `jsxDEV` for an unminified build, and React's dev jsx
  // runtime reaches into React's shared internals — so a bundled copy running
  // against the host's React fails at first render with
  // "dispatcher.getOwner is not a function". Externalizing only
  // `react/jsx-runtime` looks right and silently isn't.
  "react/jsx-dev-runtime",
  "lucide-react",
  "@/wigl",
  "@/wigl/hooks",
  "@/wigl/utils",
  "@/components/ui/badge",
  "@/components/ui/button",
  "@/components/ui/checkbox",
  "@/components/ui/input",
  "@/components/ui/progress",
  "@/components/ui/select",
  "@/components/ui/separator",
  "@/components/ui/slider",
  "@/components/ui/switch",
  "@/components/ui/table",
  "@/components/ui/tabs",
] as const;

export type HostModuleId = (typeof HOST_MODULE_IDS)[number];
