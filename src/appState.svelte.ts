import type { BrushSettings } from "./brush";
import type { BrushType } from "./brush-textures";

/** Every brush the toolbar offers: the full-redraw engines plus the stamp tips. */
export type BrushKind = "smooth" | "ink" | "calligraphy" | BrushType;
import type { FillOptions } from "./fill";
import { PressureCurve } from "./pressure-curve";

export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso" | "eyedropper";

interface AppStateShape {
  currentTool: Tool;
  brushType: BrushKind;
  sizeRange: number;
  streamline: number;
  brushSettings: BrushSettings;
  fillSettings: FillOptions;
  zoomText: string;
  layerVersion: number;
  selectionVersion: number;
  docWidth: number;
  docHeight: number;
  /** Selection transform: corner handles keep the aspect ratio. */
  keepProportions: boolean;
  /** Fill enclosed: bridge outline breaks of about 2×this px (0..MAX_GAP). */
  fillEnclosedGap: number;
  /** Transient message for the status bar (see flashStatus). */
  statusMessage: string;
}

export const app: AppStateShape = $state({
  currentTool: "brush",
  brushType: "smooth",
  sizeRange: 1.0,
  streamline: 50,
  brushSettings: {
    size: 4,
    taper: false,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    isEraser: false,
    drawBehind: false,
    alphaLock: false,
    nibAngle: 45,
    nibFlatness: 0.35,
    dwellPool: 0,
  },
  fillSettings: {
    tolerance: 32,
    alphaThreshold: 0,
    expand: 0,
  },
  zoomText: "100%",
  layerVersion: 0,
  selectionVersion: 0,
  docWidth: 1920,
  docHeight: 1080,
  keepProportions: true,
  fillEnclosedGap: 0,
  statusMessage: "",
});

// PressureCurve is not reactive — it's an imperative canvas widget
/** One curve per stroke tool: the eraser got its own so a tuned brush feel isn't shared. */
export const pressureCurves = { brush: new PressureCurve(), eraser: new PressureCurve() };

/** The curve for the active tool — the eraser's own, everything else the brush's. */
export function activePressureCurve(): PressureCurve {
  return app.currentTool === "eraser" ? pressureCurves.eraser : pressureCurves.brush;
}

export function bumpLayerVersion() {
  app.layerVersion++;
}

export function bumpSelectionVersion() {
  app.selectionVersion++;
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;
/** Show a short message in the status bar, e.g. why an action did nothing. */
export function flashStatus(message: string, ms = 4000) {
  app.statusMessage = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (app.statusMessage = ""), ms);
}
