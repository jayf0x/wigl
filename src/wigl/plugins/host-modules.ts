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
