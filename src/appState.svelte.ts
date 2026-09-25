import type { BrushSettings } from "./brush";
import type { BrushType } from "./brush-textures";

/** Every brush the toolbar offers: the full-redraw engines plus the stamp tips. */
export type BrushKind = "smooth" | "ink" | "calligraphy" | BrushType;
import type { FillOptions } from "./fill";
import { PressureCurve } from "./pressure-curve";
import { DEFAULT_PANEL_WIDTH } from "./panel-layout";

export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso" | "eyedropper" | "outline";

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
  /** Bumped by the undo stack so canUndo/canRedo can drive the UI (a class getter is not reactive). */
  historyVersion: number;
  /** Layer panel width in px (drag its left edge). */
  layerPanelWidth: number;
  /** Transient message for the status bar (see flashStatus). */
  statusMessage: string;
  /** What the control under the pointer does — iPad has no hover, so titles go here. */
  statusHint: string;
  /** Outline tool knobs (see `outline.ts`). Session-only, not saved with the settings. */
  outline: { thickness: number; wobble: number; variation: number; seed: number };
  /** An Outline preview is live in the active layer (Apply/Cancel can act). */
  outlineActive: boolean;
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
  historyVersion: 0,
  layerPanelWidth: DEFAULT_PANEL_WIDTH,
  statusMessage: "",
  statusHint: "",
  outline: { thickness: 3, wobble: 0.35, variation: 0.35, seed: 1 },
  outlineActive: false,
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
  // ms 0 = sticky: for conditions (e.g. autosave failing) rather than one-off explanations.
  if (ms > 0) statusTimer = setTimeout(() => (app.statusMessage = ""), ms);
}
