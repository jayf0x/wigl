import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

const BUTTON_VARIANTS = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "destructive",
  "error",
  "info",
  "success",
  "warning",
] as const;

/** Real coss ui components wired up to the live theme via their normal
 * semantic classes (bg-primary, bg-destructive, ...) — no props override
 * their colors. If a component here looks wrong, the fault is in the theme
 * tokens (SemanticSwatches), not in this panel. */
export const ComponentsPanel = () => {
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(true);
  const [slider, setSlider] = useState(40);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 text-[10px] tracking-widest text-muted-foreground uppercase">Buttons</div>
        <div className="flex flex-wrap gap-2">
          {BUTTON_VARIANTS.map((v) => (
            <Button key={v} variant={v} size="sm">
              {v}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] tracking-widest text-muted-foreground uppercase">Badges</div>
        <div className="flex flex-wrap gap-2">
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
          checkbox
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <Switch checked={switched} onCheckedChange={setSwitched} />
          switch
        </label>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] tracking-widest text-muted-foreground uppercase">Slider ({slider})</div>
        <Slider value={slider} onValueChange={(v) => setSlider(Array.isArray(v) ? v[0] : v)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="input" className="w-32" />
        <Select defaultValue="a">
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Option A</SelectItem>
            <SelectItem value="b">Option B</SelectItem>
            <SelectItem value="c">Option C</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] tracking-widest text-muted-foreground uppercase">Progress</div>
        <Progress value={65} />
      </div>

      <Separator />
      <div className="rounded-lg border border-border bg-card p-3 text-card-foreground">
        <div className="text-sm font-medium">Card surface</div>
        <div className="text-muted-foreground text-xs">bg-card / text-card-foreground / border-border</div>
      </div>
    </div>
  );
};
