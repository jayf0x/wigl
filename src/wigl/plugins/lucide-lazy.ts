import * as React from "react";
import { DynamicIcon } from "lucide-react/dynamic";
import dynamicIconImports from "lucide-react/dynamicIconImports";

// The eager `import * as LucideReact from "lucide-react"` this replaces
// pulled every icon's SVG node data into one chunk purely because the host
// can't know ahead of time which icons any given plugin
// will use. This proxy hands out a small wrapper component per name instead
// — the underlying icon only gets dynamically imported (via lucide-react's
// own `DynamicIcon`) the first time that wrapper actually renders.
//
// PascalCase name -> Lucide's own kebab-case key, derived the same way
// Lucide derives it: capitalize each hyphen-separated segment. Both the
// bare name (`ChevronDown`) and the "Icon"-suffixed current-style name
// (`ChevronDownIcon`) resolve to the same icon. Deprecated multi-alias
// names (e.g. `Verified` for `badge-check`) aren't covered — nothing in
// this codebase uses one, and adding them means parsing lucide-react's full
// export list rather than a name transform.
const kebabToPascal = (kebab: string) =>
  kebab
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

const nameToKebab = new Map<string, string>();
for (const kebab of Object.keys(dynamicIconImports)) {
  const pascal = kebabToPascal(kebab);
  nameToKebab.set(pascal, kebab);
  nameToKebab.set(`${pascal}Icon`, kebab);
}

type DynamicIconProps = React.ComponentProps<typeof DynamicIcon>;

const componentCache = new Map<string, React.ForwardRefExoticComponent<Omit<DynamicIconProps, "name">>>();

const iconComponent = (kebab: string) => {
  let Comp = componentCache.get(kebab);
  if (!Comp) {
    Comp = React.forwardRef<SVGSVGElement, Omit<DynamicIconProps, "name">>((props, ref) =>
      React.createElement(DynamicIcon, { ...props, name: kebab as DynamicIconProps["name"], ref }),
    );
    componentCache.set(kebab, Comp);
  }
  return Comp;
};

/** A `lucide-react`-shaped object where every property access lazily
 * resolves (and caches) a per-icon component, instead of the whole icon set
 * being present up front. */
export const lucideLazy: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (typeof prop !== "string") return undefined;
      const kebab = nameToKebab.get(prop);
      return kebab ? iconComponent(kebab) : undefined;
    },
    has: (_target, prop) => typeof prop === "string" && nameToKebab.has(prop),
    ownKeys: () => [...nameToKebab.keys()],
    getOwnPropertyDescriptor: (_target, prop) =>
      typeof prop === "string" && nameToKebab.has(prop)
        ? { enumerable: true, configurable: true, value: iconComponent(nameToKebab.get(prop)!) }
        : undefined,
  },
);
