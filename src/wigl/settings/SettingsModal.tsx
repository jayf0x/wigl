import { relaunch } from "@tauri-apps/plugin-process";
import { RotateCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRestartRequired } from "./restartBanner";
import { useSettingsSections } from "./registry";
import { appearanceSection } from "./sections/appearance";
import { backgroundSection } from "./sections/background";
import { gridSection } from "./sections/grid";
import { storageSection } from "./sections/storage";
import { widgetsSection } from "./sections/widgets";
import type { SettingSection } from "./types";

// Sections that always exist, regardless of which widgets are installed —
// contrast with useSettingsSections()'s registry, which is widget-
// contributed and can be empty. Add a new core section (Grid, Storage, ...)
// here as its own sections/*.tsx export, same shape as appearanceSection.
const BUILTIN_SECTIONS: SettingSection[] = [
  appearanceSection,
  backgroundSection,
  gridSection,
  storageSection,
  widgetsSection,
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The general Settings modal — a centered dialog with a section rail on the
 * left and a plain substring search across every section's declared fields
 * up top. Replaces the old anchored ThemeSettingsPopover; theme's own live-
 * apply-on-change now lives in theme/ThemeEffect.tsx, mounted unconditionally
 * alongside this modal so it keeps working whether or not the modal is open.
 */
export const SettingsModal = ({ open, onClose }: SettingsModalProps) => {
  const restartRequired = useRestartRequired();
  const registered = useSettingsSections();
  const sections = useMemo(() => [...BUILTIN_SECTIONS, ...registered], [registered]);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
  const [query, setQuery] = useState("");

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  // Flat field index across every section, for the search box. A field
  // matches on its own label/keywords or its parent section's label — a
  // plain substring test, no fuzzy-search dependency (see todo-settings-ui.md).
  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? null
      : sections.flatMap((section) =>
          (section.fields ?? [{ id: section.id, label: section.label, keywords: [] }])
            .filter(
              (f) =>
                f.label.toLowerCase().includes(q) ||
                section.label.toLowerCase().includes(q) ||
                f.keywords?.some((k) => k.toLowerCase().includes(q)),
            )
            .map((f) => ({ section, field: f })),
        );

  const jumpTo = (sectionId: string) => {
    setActiveId(sectionId);
    setQuery("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-no-drag
        className="flex h-[min(560px,80vh)] w-[min(640px,92vw)] flex-col"
        onKeyDown={(e) => {
          // Popup's own Escape-to-close is fine; this just clears an active
          // search first so Escape reads as "back out one step" like most
          // command palettes, not "always closes the whole modal".
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setQuery("");
          }
        }}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2.5">
          <span className="select-none font-mono text-[11px] text-muted-foreground/70">/</span>
          <Input
            unstyled
            nativeInput
            autoFocus
            placeholder="Search settings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          <DialogClose
            title="Close (Esc)"
            aria-label="Close settings"
            className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-3.5" />
          </DialogClose>
        </div>

        {restartRequired && (
          <div className="flex items-center justify-between gap-2 border-amber-500/30 border-b bg-amber-500/10 px-3 py-1.5 text-amber-600 text-xs dark:text-amber-400">
            <span>Restart wigl to apply the changed setting.</span>
            <button
              type="button"
              onClick={() => relaunch()}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-amber-500/15"
            >
              <RotateCw className="size-3" />
              Restart
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-36 shrink-0 flex-col gap-0.5 overflow-y-auto border-border/60 border-r p-2">
            {sections.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jumpTo(s.id)}
                className={cnTab(s.id === active?.id && !matches)}
              >
                <span className="w-4 shrink-0 text-muted-foreground/50 tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-3.5">
            {matches ? (
              matches.length === 0 ? (
                <div className="px-1 py-6 text-center text-muted-foreground text-xs">
                  No settings match "{query}"
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {matches.map(({ section, field }) => (
                    <button
                      key={`${section.id}:${field.id}`}
                      type="button"
                      onClick={() => jumpTo(section.id)}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      <span>{field.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                        {section.label}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              active?.render()
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const cnTab = (active: boolean | undefined) =>
  [
    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
    active ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-accent/50",
  ].join(" ");
