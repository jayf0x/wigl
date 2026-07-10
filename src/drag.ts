import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, currentMonitor } from "@tauri-apps/api/window";

// ponytail: manual drag instead of data-tauri-drag-region — moves the window
// by the same % of screen the mouse moved, not raw px, so a drag that
// crosses onto a monitor with a different size/DPI still lands proportionally
// correct instead of overshooting.
let drag: {
  mouseX: number;
  mouseY: number;
  winXPct: number;
  winYPct: number;
  screenW: number;
  screenH: number;
} | null = null;

function onMove(e: MouseEvent) {
  if (!drag) return;
  const dxPct = (e.screenX - drag.mouseX) / drag.screenW;
  const dyPct = (e.screenY - drag.mouseY) / drag.screenH;
  const x = (drag.winXPct + dxPct) * drag.screenW;
  const y = (drag.winYPct + dyPct) * drag.screenH;
  getCurrentWindow().setPosition(new LogicalPosition(x, y));
}

function onUp() {
  drag = null;
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("mouseup", onUp);
}

export async function onDragHandleMouseDown(e: React.MouseEvent) {
  if (e.button !== 0) return;
  const win = getCurrentWindow();
  const [pos, monitor] = await Promise.all([win.outerPosition(), currentMonitor()]);
  if (!monitor) return;
  const logicalPos = pos.toLogical(monitor.scaleFactor);
  const logicalScreen = monitor.size.toLogical(monitor.scaleFactor);
  drag = {
    mouseX: e.screenX,
    mouseY: e.screenY,
    winXPct: logicalPos.x / logicalScreen.width,
    winYPct: logicalPos.y / logicalScreen.height,
    screenW: logicalScreen.width,
    screenH: logicalScreen.height,
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
