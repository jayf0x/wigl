import { Widget, WidgetHeader } from "@/wigl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComponentsPanel } from "./ComponentsPanel";
import { PalettePanel } from "./PalettePanel";
import { SemanticSwatches } from "./SemanticSwatches";

// A pure QA surface, no useQaColorsWidget hook / config.ts — there's no
// external data, just live CSS-var reads (see SemanticSwatches). Sized big
// on purpose: this widget exists to eyeball dozens of swatches and live
// components at once while dragging the theme popover's knobs (see
// src/wigl/ThemeSettingsPopover.tsx) in another window on the same screen.
const QaColorsWidget = () => (
  <Widget w={13} h={9} col={0} row={0}>
    <WidgetHeader>
      <span className="px-1 text-[10px] tracking-widest opacity-40">QA COLORS</span>
    </WidgetHeader>
    <div className="flex-1 overflow-y-auto p-3">
      <Tabs defaultValue="theme">
        <TabsList>
          <TabsTrigger value="theme">Theme tokens</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="palette">Tailwind palette</TabsTrigger>
        </TabsList>
        <TabsContent value="theme">
          <SemanticSwatches />
        </TabsContent>
        <TabsContent value="components">
          <ComponentsPanel />
        </TabsContent>
        <TabsContent value="palette">
          <PalettePanel />
        </TabsContent>
      </Tabs>
    </div>
  </Widget>
);

export default QaColorsWidget;
