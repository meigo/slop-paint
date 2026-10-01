import { PRESS_DEFAULT, type BrushSettings } from "./brush";
import type { BrushType } from "./brush-textures";

/** Every brush the toolbar offers: the full-redraw engines plus the stamp tips. */
export type BrushKind = "smooth" | "ink" | "calligraphy" | "dry" | BrushType;
import type { FillOptions } from "./fill";
import { PressureCurve } from "./pressure-curve";
import { DEFAULT_PANEL_WIDTH } from "./panel-layout";
import { isAppleTouch } from "./share";

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
  /** Settings: show the Spine tag UI (layer strip chips/menu, "for Spine" export wording). */
  spineTools: boolean;
  /** Settings: keep layers at the screen's pixel density (2× on Retina/iPad, 4× the memory) rather
   *  than at document pixels. Saves and exports are document pixels either way. */
  hiResLayers: boolean;
  /** Bridge, for the bucket AND Fill enclosed: close line breaks of about 2×this px (0..MAX_GAP).
   *  Saved under its old name, from when only Fill enclosed had it. */
  fillEnclosedGap: number;
  /** Bumped by the undo stack so canUndo/canRedo can drive the UI (a class getter is not reactive). */
  historyVersion: number;
  /** Layer panel width in px (drag its left edge). */
  layerPanelWidth: number;
  /** Transient message for the status bar (see flashStatus). */
  statusMessage: string;
  /** A lasting condition (autosave off or failing), shown whenever no short message is: a later
   *  ordinary message used to replace it for good, leaving e.g. "autosave is off" unsaid. */
  statusSticky: string;
  /** What the control under the pointer does — iPad has no hover, so titles go here. */
  statusHint: string;
  /** Fill's own colour and opacity (as slop-animator): outlines and flats are different colours, so
   *  the bucket no longer shares the brush's swatch. */
  fillColor: string;
  fillOpacity: number;
  /** The project's name: save and export file names come from it (as slop-animator). */
  projectName: string;
  /** Which colour the eyedropper sets: the fill's when it will hand back to Fill, else the brush's. */
  eyedropperTarget: "brush" | "fill";
  /** Outline tool knobs (see `outline.ts`). Session-only, not saved with the settings. */
  outline: { thickness: number; wobble: number; variation: number; seed: number };
  /** An Outline preview is live in the active layer (Apply/Cancel can act). */
  outlineActive: boolean;
}

export const app: AppStateShape = $state({
  currentTool: "brush",
  brushType: "smooth",
  sizeRange: PRESS_DEFAULT,
  streamline: 50,
  brushSettings: {
    size: 4,
    taper: false,
    sharpCorners: false,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    isEraser: false,
    drawBehind: false,
    alphaLock: false,
    nibAngle: 45,
    nibFlatness: 0.35,
    dwellPool: 0,
    dryness: 50,
  },
  fillSettings: {
    tolerance: 32,
    expand: 0,
  },
  zoomText: "100%",
  layerVersion: 0,
  selectionVersion: 0,
  docWidth: 1920,
  docHeight: 1080,
  keepProportions: true,
  spineTools: true,
  // Off on iPad: 40 layers at 2× (1.2 GB) got blanked in the background.
  hiResLayers:
    typeof navigator === "undefined" ||
    !isAppleTouch(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
  fillEnclosedGap: 0,
  historyVersion: 0,
  layerPanelWidth: DEFAULT_PANEL_WIDTH,
  statusMessage: "",
  statusSticky: "",
  statusHint: "",
  fillColor: "#1a1a1a",
  fillOpacity: 100,
  eyedropperTarget: "brush",
  projectName: "untitled",
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
/** Show a short message in the status bar, e.g. why an action did nothing. `ms = 0` is a lasting
 *  condition (autosave failing or off) rather than a one-off explanation: it stays, behind any
 *  later short message, until `clearSticky`. */
export function flashStatus(message: string, ms = 4000) {
  clearTimeout(statusTimer);
  if (ms === 0) {
    app.statusSticky = message;
    app.statusMessage = "";
    return;
  }
  app.statusMessage = message;
  statusTimer = setTimeout(() => (app.statusMessage = ""), ms);
}

/** End a lasting condition (`flashStatus(msg, 0)`); with `message`, only if it's the one showing. */
export function clearSticky(message?: string) {
  if (message === undefined || app.statusSticky.startsWith(message)) app.statusSticky = "";
}
