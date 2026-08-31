import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStorage } from "../../hooks/useStorage";
import type { GridOverrides } from "../../grid/config";
import { TILING } from "../../grid/config";
import type { SettingSection } from "../types";

// Live (Tier 1): the override object is a plain `useStorage` row ("wigl_grid").
// Desktop.tsx reads the same key, applies it onto the running TILING and
// rebuilds the layout — no restart. Grid math is entirely JS-side (Rust
// never sees TILING), so there was never anything a restart was actually
// needed to re-read; the old Tier-2 path just predated wiring the re-apply.
//
// liftScale/spring/field are left out — TILING's more cosmetic/animation
// knobs, nobody's asked to tune them yet. Add a row here the same way if
// that changes. ponytail: scope kept to the fields someone would plausibly
// resize their grid with.
const NUMBER_FIELDS: Array<{ key: "cell" | "gap"; label: string }> = [
  { key: "cell", label: "Cell size (px)" },
  { key: "gap", label: "Gap (px)" },
];

const PADDING_FIELDS: Array<{ key: "top" | "right" | "bottom" | "left"; label: string }> = [
  { key: "top", label: "Top" },
  { key: "right", label: "Right" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
];

const NULLABLE_FIELDS: Array<{ key: "cols" | "rows"; label: string; hint: string }> = [
  { key: "cols", label: "Columns", hint: "fixed column count, blank = fill screen width" },
  { key: "rows", label: "Rows", hint: "max rows a drag can target, blank = unlimited" },
];

const GridSection = () => {
  const [overrides, setOverrides] = useStorage<GridOverrides>("wigl_grid", {});
  const current = {
    ...TILING,
    ...overrides,
    padding: { ...TILING.padding, ...overrides.padding },
  };

  const commit = (next: GridOverrides) => setOverrides(next);

  const reset = () => commit({});

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="outline"
        size="sm"
        onClick={reset}
        disabled={Object.keys(overrides).length === 0}
        className="w-fit"
      >
        Reset to default
      </Button>

      <div>
        <div className="mb-2 px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
          Cells
        </div>
        <div className="flex flex-col gap-1.5">
          {NUMBER_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2 px-1">
              <span className="w-28 shrink-0 text-xs">{label}</span>
              <Input
                type="number"
                min={1}
                value={current[key] as number}
                onChange={(e) => commit({ ...overrides, [key]: Number(e.target.value) || 1 })}
                className="h-7 w-24"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-border/60 border-t pt-3">
        <div className="mb-2 px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
          Padding (px)
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-1">
          {PADDING_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs">{label}</span>
              <Input
                type="number"
                min={0}
                value={current.padding[key]}
                onChange={(e) =>
                  commit({
                    ...overrides,
                    padding: { ...overrides.padding, [key]: Number(e.target.value) || 0 },
                  })
                }
                className="h-7 w-20"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-border/60 border-t pt-3">
        <div className="mb-2 px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
          Bounds
        </div>
        <div className="flex flex-col gap-1.5">
          {NULLABLE_FIELDS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center gap-2 px-1">
              <span className="w-20 shrink-0 text-xs" title={hint}>
                {label}
              </span>
              <Input
                type="number"
                min={1}
                placeholder="unlimited"
                value={current[key] == null ? "" : (current[key] as number)}
                onChange={(e) => {
                  const raw = e.target.value;
                  commit({ ...overrides, [key]: raw === "" ? null : Number(raw) || null });
                }}
                className="h-7 w-24"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const gridSection: SettingSection = {
  id: "grid",
  label: "Grid",
  fields: [
    { id: "grid-cell", label: "Cell size", keywords: ["grid", "size", "px"] },
    { id: "grid-gap", label: "Gap", keywords: ["grid", "spacing"] },
    { id: "grid-padding", label: "Padding", keywords: ["grid", "margin"] },
    { id: "grid-bounds", label: "Columns and rows", keywords: ["grid", "cols", "rows", "bounds"] },
  ],
  render: () => <GridSection />,
};
